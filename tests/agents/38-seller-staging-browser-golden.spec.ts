/**
 * 38 — Golden Dynamic Seller deployed-staging acceptance.
 *
 * Creates a fresh Seller vehicle for every run/project. No Golden Reference vehicle, DB seed or
 * page.route() shortcut is used. The same exact-head frontend/backend pair is driven on Desktop
 * Chrome and Pixel 5 by playwright.staging.config.ts.
 *
 * Coverage:
 *   integration lifecycle proof only. This test is deliberately NOT the human-facing Golden Seller
 *   Journey from the canonical remediation plan; that journey must enter through Home/Sell and the
 *   real Seller UI. This lower-level deployed acceptance still proves governed create/media,
 *   publication, inquiry and retirement contracts, and now guarantees it cannot contaminate human UAT.
 *
 */
import { readFileSync } from 'node:fs';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  stagingTest as test,
  expect,
  signInViaUi,
  requireIdentity,
  API_URL,
  RUN_ID,
} from './staging-helpers';

interface SessionAuth {
  token: string;
  user: { id: string; role: string; [key: string]: unknown };
}

interface EnvTruth {
  runId: string;
  webUrl: string;
  apiUrl: string;
  servedBundle: string;
  expectedBundle: string | null;
  mode: 'acceptance' | 'harness-validation';
  health?: unknown;
}

const SELLER_EMAIL = 'uat.buyer@carup-staging.test';
const REVIEWER_EMAIL = 'uat.reviewer@carup-staging.test';

// Browser visual acceptance uses seven 320x180 vehicle-like PNG entries with multiple distinct views. They are deliberately
// different and large enough for intrinsic-dimension/render assertions; a 1x1 transport fixture can
// never satisfy Seller media certification.
const VISUAL_TEST_PNGS = [
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAADTUlEQVR42u3dr1JqURTA4cMekoU3cMZmshj0DSwWi8Vgolg1WEwWg1YLyWCxWCy+gQaLRYMzzlgIFgiYDTYFHP9wYO39fdHrHeaetX5nA87FxmtvUAExJZcABAwIGBAwCBgQMCBgQMAgYGA2NMf/8dzhwtCvvx08u3bgBAYEDAIGBAwIGBAwCBgQMCBgQMAgYEDAgIBBwICAAQEDAgYBAwIGBAzFa/j1ouAEBgQMCBgEDAgYEDAgYBAwIGBAwCBgQMCAgAEBg4ABAQMCBgQMAgYEDAgYBAwIGBAwIGAQMCBgQMCAgEHAgIABAYOAAQEDAgYEDAIGBAwIGAQMCBgQMCBgKEKz8H9/e2fPEsygzumxi+AEVq/RCNiKYEAChl80LGMBu7sbloAtBEYmYKuAwf2jxmtvYAn+xfbufmnbc3ZyVP+D+gmT18C4CwvY4DFKARs5Bipgw9awgI2ZaMMtfL5JvZiygEHDAjZUjFvA6tWwgA2SkKMvavpJvdgBAYOGBWxsWIZiA1Yvpb0kTurFUSxgE8KGCBg0/BM5fCLHp8H0+33LyigX5x0Bz/RtVcCM0Wq1qow+lydlVi8UtTnJDNCwgF19bJGAQcM/EfJNrPEX3ZtYjPHxJtZXQd/WSpnVC0XtVXKVIe52JdcX4u6YN7Hgc8OBMk6BLqvdwr6FDFi92LqhMvz1optbbcvHKJn9ZwavgUHAgIABAUMpmi7BKC+Pt0O/Pr+44uKYgoCDbczXb7BDpiDgSEsz9PtlbApeA8fbm7//RUzBCTzNpXEImIITOPzeOARMQcDh90bDpiBgQMBTvU87hE1BwFH3RsOmIGBAwFO9NzuETUHAwDcy/ESOb60uL9XwKDd399bLFJzAIfemzgcyhZKn4Ck0CBiYhma323UVJsS1NQUnMCBgEDAgYEDAv3J5dZ3ZA5lCyVNwAoOAAQFn87TK82dTEDAg4NrvzY5fUxBw1O1RrykIGBBw7fdpx68pCDjq9qjXFOrXuH94skBVVW2sr1kaU3ACF3cIqNcUnMAhDwHpmoKA4+2Qbk1BwIDXwCBgQMCAgAEBg4ABAQMCBgQMAgYEDAgYBAwIGBAwIGAQMCBgQMCAgEHAgIABAYOAAQEDk/cOJ+NUu9ib8UEAAAAASUVORK5CYII=',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAADS0lEQVR42u3dsS7zURjAYT3pLlyD2AwmRpvFYnAJxGSStJdAYjIJl2CwWGxGJgmDRLrZEFJXYLCIVqsV//7fc55n9PnS5Lzvr6ftl4/G4/P7FBBTcgQgYEDAgIBBwICAAQEDAgYBA/XQHPzHs3tzfb/+2u6M9D2AGxgQMAgYEDAgYBAwIGBAwICAQcCAgAEBAwIGAQMCBgQMAgYEDAgYEDDkqOHXi4IbGBAwIGAQMCBgQMCAgEHAgIABAYOAAQEDAgYEDAIGBAwIGBAwCBgQMCBgEDAgYEDAgIBBwICAAQEDAgYBAwIGBAwCBgQMCBgQMAgYEDAgYBAwIGBAwICAoQhNR/BVa7flEGpo/2DfIbiB1Ws0ArYiGJCAYYyGZSxgz+6GJWALgZEJ2CpgcH/ReHx+twT/YWOnXdp5nh7uVf+ghf8Lk5fQeBYWsMFjlAI2cgxUwIatYQEbMwGHW9p8k3oxZQGDhgVsqBi3gNVLIUNPBkneo897+km92AEBg4YFbGxYBgGrl0LeEif14ioWsAlhQwQMGh5Fhj+R49tg3rpdy8pPjk+OBFzrp1UBM8DM9PRU5J/Lk/KuF/LenGQGEHd/ktOHuFvkU2gI3HAOH2INPnQfYjHA54dYvaJ8rJXyrhfy3qvklCHudiXnC3F3zIdYMKThOmec4h6r3cK+JacJcbcu/18vurW5bfn4SfT/zOA9MAgYEDAgYChF0xH80sPddd+vzy8sORxTEHCwjen9BiWbgoAjLU3f75exKXgPHG9v/v4XMQU38CSXxlVsCm7g8HvjKjYFAYffGw2bgoABAU/0edolbAoCjro3GjYFAQMCnuhzs0vYFAQMfJf/T+QYamV5sYJHuby6sW2m4AYOuTdVPpApFDUFL6FBwMAkNN9enpxCNRy1KbiBAQGDgAEBAwIey9n5RWYPZApFTcENDAIGBJzr6zevn01BwICAK39udv2agoCjbo96TUHAgIArf552/ZqCgKNuj3pNoQKN2/uOjem1vrZqaUzBDVzcJaBeU3ADh7wEpGsKAo63Q7o1BQED3gODgAEBAwIGBAwCBgQMCBgQMAgYEDAgYBAwIGBAwICAQcCAgAEBg4ABAQMCBgEDPyDDyCDXeXi+Ws1AAAAAElFTkSuQmCC=',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAADU0lEQVR42u3dMUtbURiAYXPInqGbf8DNQQSnzgq6+DOkg4NgxcHBQVRwcBB/houCnTsVxCGLlDhnE8nk6uCm8Uqi3nu/c55ntCmB831vjkmpdgbDxxkgpuQIQMCAgAEBg4ABAQMCBgQMAgbaoVv9x7Mnc2O/Ptz6/+WPAdzAIGBAwICAAQGDgAEBAwIGAQMCBgQMCBgEDAgYEDAgYBAwIGBAwCBgIJqOXy8KbmBAwICAAQMCBgEDAgYEDAgYBAwIGBAwCBgQMCAgAEBg4ABAQMCBgQMAgYEDAgYBAwIGBAwIGAQMCBgQMCAgEHAgIABAYOAAQEDAgYEDAIGBAwIGAQMCBgQMCBgKEKz8H9/e2fPEsygzumxi+AEVq/RCNiKYEAChl80LGMBu7sbloAtBEYmYKuAwf2jxmtvYAn+xfbufmnbc3ZyVP+D+gmT18C4CwvY4DFKARs5Bipgw9awgI2ZaMMtfL5JvZiygEHDAjZUjFvA6tWwgA2SkKMvavpJvdgBAYOGBWxsWIZiA1Yvpb0kTurFUSxgE8KGCBg0/BM5fCLHp8H0+33LyigX5x0Bz/RtVcCM0Wq1qow+lydlVi8UtTnJDNCwgF19bJGAQcM/EfJNrPEX3ZtYjPHxJtZXQd/WSpnVC0XtVXKVIe52JdcX4u6YN7Hgc8OBMk6BLqvdwr6FDFi92LqhMvz1optbbcvHKJn9ZwavgUHAgIABAUMpmi7BKC+Pt0O/Pr+44uKYgoCDbczXb7BDpiDgSEsz9PtlbApeA8fbm7//RUzBCTzNpXEImIITOPzeOARMQcDh90bDpiBgQMBTvU87hE1BwFH3RsOmIGBAwFO9NzuETUHAwDcy/ESOb60uL9XwKDd399bLFJzAIfemzgcyhZKn4Ck0CBiYhma323UVJsS1NQUnMCBgEDAgYEDAv3J5dZ3ZA5lCyVNwAoOAAQFn87TK82dTEDAg4NrvzY5fUxBw1O1RrykIGBBw7fdpx68pCDjq9qjXFOrXuH94skBVVW2sr1kaU3ACF3cIqNcUnMAhDwHpmoKA4+2Qbk1BwIDXwCBgQMCAgAEBg4ABAQMCBgQMAgYEDAgYBAwIGBAwIGAQMCBgQMCAgEHAgIABAYOAAQEDk/cOJ+NUu9ib8UEAAAAASUVORK5CYII=',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAADR0lEQVR42u3dvTJrURiA4Z016VVuQOkCqGk0Cu6BVo0ZlRlSp+UeKDQa6iiZoTFm1FJIo6XQyd/42zvfWs9TOjmTOfv73r0k5kTr7rlfATEllwAEDAgYEDAIGBAwIGBAwCBgYDa0J//xQndx5Nefdu4beQzgBAYBAwIGBAwCBgQMCBgQMAgYEDAgYEDAIGBAwICAQcCAgAEBAwIGAQOzpOXXi4ITGBAwIGAQMCBgQMCAgEHAgIABAYOAAQEDAgYEDAIGBAwIGBAwCBgQMCBgEDAgYEDAgIBBwICAAQEDAgYBAwIGBAwCBgQMCBgQMAgYEDAgYBAwIGBAwICAoQjtwv/9J50DSzCDtncPXQQnsHqNRsBWBAMSMPygYRkL2N3dsARsITAyAVsFDO4Pte6e+5bgT6xs7Za2Pdennfqf1E+YvAbGXVjABo9RCtjIMVABG7aGBWzMRBtu4fNN6sWUBQwaFrChYtwCVq+GBWyQhBx9UdNP6sUOCBg0LGBjwzIUG7B6Ke0lcVIvjmIBmxA2RMCg4e/I4RM5vgzmZTCwrIyzf9wV8EzfVgXMBPNzc1VGn8uTMqsXitqcZAZoWMCuPrZIwKDh7wj5Jtbki+5NLCb4fBNrWNC3tVJm9UJRe5VcZYi7Xcn1hbg75k0s+NpwoIxToMtqt7BvIQNWL7ZupAx/vejR3o7lY5zM/jOD18AgYEDAgYChFG2XYJybXm/k15eWl10cUxBwsI0ZfoAdMgUBR1qakY+XsSl4DRxvb37/FzEFJ3CTS+MQMAUncPi9cQiYgoDD742GTUHAgIAbvU87hE1BwFH3RsOmIGBAwI3emx3CpiBgYIoMP5Fjqo3VOn7Wf37lEDYFJ3DMvanziUyh5Cn4FhoEDDSh/f726ir8E9fWFJzAgIBBwICAAQH/yNnFZWZPZAolT8EJDAIGBJzNt1W+fzYFAQMCrv3e7Pg1BQFH3R71moKAAQHXfp92/JqCgKNuj3pNoX6t24dHC1RV1eb6mqUxBSdwcYeAek3BCRzyEJCuKQg43g7p1hQEDHgNDAIGBAwIGBAwCBgQMCBgQMAgYEDAgIBBwICAAQEDAgYBAwIGBAwIGAQMCBgQMAgYEDDw/z4A6nlwOTryLSsAAAAASUVORK5CYII=',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAADS0lEQVR42u3dIUvrURjAYXcYGI1+B8E8ELFaLGKxmTUINosgWGyCQbPNIhaLVUSQNQUt+wKLYrQYLLLNqRv77/+e8zzR62Vw3ve3s+1ytdHudGeAmJIjAAEDAgYEDAIGBAwIGBAwCBioh+bwP144Xxz49Zft59p+D7iBAQEDAgYEDAIGBAwIGAQMCBgQMCBgEDAgYEDAgIBBwICAAQGDgAEBA1Vp+PWi4AYGBAwIGAQMCBgQMCBgEDAgYEDAIGBAwICAAQGDgAEBAwIGBAwCBgQMCBgEDAgYEDAgYBAwIGBAwICAQcCAgAEBg4ABAQMCBgQMAgYEDAgYBAwIGBAwIGAoQtMRfHd1eugQamhj11zcwOo1GgFbEQxIwDBKwzIWsGd3wxKwhcDIBGwVMLhxNNqdriWYhNbWfmnn+XhxXP2DFv4vTF5C41lYwAaPUQrYyDFQARu2hgVszAQcbmnzTerFlAUMGhawoWLcAlYvhQw9GSR5jz7v6Sf1YgcEDBoWsLFhGQSsXgp5S5zUi6tYwCaEDREwaPg/MvyJHD2D6b69WVZ+snNwIuBaP60KmCHm5+ZmIv9cnpR3vZD35iQzgLj7k5w+xN0in0JD4IZz+BBr+KH7EIshvj7E6hflY62Ud72Q914lpwxxtys5X4i7Yz7Egl8arnPGKe6x2i3sW3KaEHfr8v/1omdHe5aPn0T/zwzeA4OAAQEDAoZSNB3BH93dPw78+spyy+GYgoCDbUz/NyjZFAQcaWkGfr+MTcF74Hh7M/5fxBTcwNNcGlexKbiBw++Nq9gUBBx+bzRsCgIGBDzV52mXsCkIOOreaNgUBAwIeKrPzS5hUxAw0Cv/n8jxq83VpQoe5fL2wbaZghs45N5U+UCmUNQUvIQGAQPT0Jz9eHcK1XDUpuAGBgQMAgYEDAh4JNc3t5k9kCkUNQU3MAgYEHCur9+8fjYFAQMCrvy52fVrCgKOuj3qNQUBAwKu/Hna9WsKAo66Peo1hQo0nl47Nqbf+tqqpTEFN3Bxl4B6TcENHPISkK4pCDjeDunWFAQMeA8MAgYEDAgYEDAIGBAwIGBAwCBgQMCAgEHAgIABAQMCBgEDAgYEDAIGBAwIGBAwCBgQMDABn/lwdmMfaIfBAAAAAElFTkSuQmCC=',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAADTElEQVR42u3doU5jQRSA4XZSX81DkBAMCoEBg8GiELwBCAwKg4A3qEDVYmrAIKowhICoQYPGoBE4KLdpKffeM/N9ku2myZzzd2g3C93x5LUDxJQcAQgYEDAgYBAwIGBAwICAQcBAO/Sq/3h9sDb16w+Hj6EfA25gQMCAgEHAgIABAQMCBgEDAgYEDAgYBAwIGBAwCBgQMCBgQMAgYEDAwDJ0/XpRcAMDAgYEDAIGBAwIGBAwCBgQMCBgEDAgYEDAgIBBwICAAQEDAgYBAwIGBAwCBgQMCBgQMAgYEDAgYEDAIGBAwICAQcCAgAEBAwIGAQMCBgQMAgYEDAgYEDAUoecIKtwNzhxCC20dnjoEN7B6jUbAVgQDEjAs0LCMBezV3bAEbCEwMgFbBQxuLt3x5NX4a1iC1f2T0s7zeXhe/5OW9i9MbmC8CgvY4DFKARs5Bipgw6aUsSZjtusZDzf7+Sb1YsoCBg0L2FAxbgGrl0KGngySokaf2fSTerEDAgYNC9jYsAwCVi+FvCVO6kXGAjYhbIiAQcPzyP8ncnwbzNv7u2XlN/tHFwJu9cuqgKmw0u93Qv1cnlRUvZDZ5iQzgLj7k5w+xN0in0JD4IYz/BCr+tB9iEWFrw+xfmrtx1qpqHohs71KThnibldyvhB3x3yIBfM13KqMUzbHarcocN+S04S4W1fcrxcdXh5bPn4T7j8zeA8MgQkYBAwIGJhLzxEs5vbufurXt7c2HI4pCDjYxvx8gJJNQcCRlmbq42VsCt4Dx9ubv/9FTMEN3OTSuIpNwQ0cfm9cxaYg4PB7o2FTEDAg4EZfp13CpiDgqHujYVMQMCDgRl+bXcKmIGCgvJ/IMdPB7mYNz3I1GjtqU3ADh9ybOp/IFPKegoBBwEATev3Oh1NohJM3BTcw+BYaEDAgYEDAC7ke3WT2RKaQ9xQEDAIGBFzI92++fzYFAQMCrv212fVrCgKOuj3qNQUBAwKu/XXa9WsKAo66Peo1hf/QfZq8WJGZ9nZ3LI0puIGLuwTUawpu4JCXgHRNQcDxdki3piBgwHtgEDAgYEDAgIBBwICAAQGDgAEBAwIGBAwCBgQMCBgQMAgYEDAgYBAwIGBAwICAQcCAgIFl+AQYW3yNmgbdcgAAAABJRU5ErkSuQmCC=',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAADUElEQVR42u3dvS5sURiA4T0ro1YqlC5AoZCoVCQiEoVGo+UKiAsQroBWo1FIRCRMo5IoFKbRUIkLUOoUOuYn42fPfGs9T+nMyeTs73v3MiNnNFrtlwqIKbkEIGBAwICAQcCAgAEBAwIGAQOjodn7j+eOZzp+/XbjPvvHgBMYEDAgYBAwIGBAwCBgQMCAgAEBg4ABAQMCBgQMAgYEDAgYBAwIGBAw0E/DrxcFJzAgYEDAIGBAwICAAQGDgAEBAwIGAQMCBgQMCBgEDAgYEDAgYBAwIGBAwCBgQMCAgAEBg4ABAQMCBgQMAgYEDAgYBAwIGBAwIGAQMCBgQMAgYEDAgIABAUMRmoX/+x9O9izBCJpe33URnMDqNRoBWxEMSMDwg4ZlLGB3d8MSsIXAyARsFTC4P9RotV8swZ+YWtspbXueT/frf1I/YfIaGHdhARs8RilgI8dABWzYGhawMRNtuIXPN6kXUxYwaFjAhopxC1i9GhawQRJy9EVNP6kXOyBg0LCAjQ3LUGzA6qW0l8RJvTiKBWxC2BABg4YHkcMncnwZzOvbm2Wlm6WtAwGP9G1VwPQwOT5eZfS5PCmzeqGozUlmgIYF7OpjiwQMGh5EyDexel90b2LRw+ebWN8FfVsrZVYvFLVXyVWGuNuVXF+Iu2PexIKvDQfKOAW6rHYL+xYyYPVi6zrK8NeLXh5uWz66yew/M3gNDAIGBAwIGErRdAm6Ob++6/j1lYVZF8cUBBxsY74/wA6ZgoAjLU3Hx8vYFLwGjrc3v/+LmIITeJhL4xAwBSdw+L1xCJiCgMPvjYZNQcCAgId6n3YIm4KAo+6Nhk1BwICAh3pvdgibgoCBPjL8RI6+Nlfna3iWo7Mb62UKTuCQe1PnE5lCyVPwLTQIGBiG5sTYu6vwT1xbU3ACAwIGAQMCBgT8I2cXV5k9kSmUPAUnMAgYEHA231b5/tkUBAwIuPZ7s+PXFAQcdXvUawoCBgRc+33a8WsKAo66Peo1hfo12o9PFqiqqtXlRUtjCk7g4g4B9ZqCEzjkISBdUxBwvB3SrSkIGPAaGAQMCBgQMCBgEDAgYEDAgIBBwICAAQGDgAEBAwIGBAwCBgQMCBgQMAgYEDAgYBAwIGDg/30At/+FtxVukMkAAAAASUVORK5CYII=',
];

// Evidence transport only needs a valid image document; it is not a visual-product fixture.
const EVIDENCE_TEST_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlYV1sAAAAASUVORK5CYII=';

function envTruth(): EnvTruth {
  return JSON.parse(readFileSync('test-results/staging-env-truth.json', 'utf8')) as EnvTruth;
}

function sixDigits(input: string): string {
  let value = 0;
  for (const char of input) value = ((value * 33) + char.charCodeAt(0)) % 1_000_000;
  return String(value).padStart(6, '0');
}

function baseHeaders(auth: SessionAuth): Record<string, string> {
  return {
    'x-session-token': auth.token,
    'x-user-id': auth.user.id,
    'x-stakeholder-role': auth.user.role,
  };
}

async function authFromPage(page: Page): Promise<SessionAuth> {
  const raw = await page.evaluate(() => ({
    token: localStorage.getItem('carup_token'),
    user: localStorage.getItem('carup_user'),
  }));
  expect(raw.token, 'signed-in page has no carup_token').toBeTruthy();
  const user = JSON.parse(raw.user || '{}') as SessionAuth['user'];
  expect(user.id, 'signed-in page has no user id').toBeTruthy();
  expect(user.role, 'signed-in page has no active role').toBeTruthy();
  return { token: raw.token!, user };
}

async function mutationHeaders(request: APIRequestContext, auth: SessionAuth): Promise<Record<string, string>> {
  const headers = baseHeaders(auth);
  const response = await request.get(`${API_URL}/security/csrf-token`, { headers });
  expect(response.status(), 'CSRF token endpoint refused the staging test identity').toBe(200);
  const body = await response.json() as { csrfToken?: string };
  expect(body.csrfToken, 'CSRF token response omitted csrfToken').toBeTruthy();
  return { ...headers, 'x-csrf-token': body.csrfToken! };
}

async function reviewerAuth(request: APIRequestContext): Promise<SessionAuth> {
  const password = process.env.STAGING_UAT_REVIEWER_PASSWORD;
  expect(password, 'STAGING_UAT_REVIEWER_PASSWORD is not configured').toBeTruthy();

  // /api/auth/login is an unsafe POST and is intentionally protected by the same global CSRF
  // middleware as every browser mutation. The UI obtains a guest-bound token before login; this
  // direct staging harness must do exactly the same rather than bypassing production protection.
  const csrfResponse = await request.get(`${API_URL}/security/csrf-token`);
  expect(csrfResponse.status(), 'guest CSRF token request failed before reviewer login').toBe(200);
  const csrfBody = await csrfResponse.json() as { csrfToken?: string };
  expect(csrfBody.csrfToken, 'guest CSRF token response omitted csrfToken').toBeTruthy();

  const response = await request.post(`${API_URL}/auth/login`, {
    headers: { 'x-csrf-token': csrfBody.csrfToken! },
    data: { email: REVIEWER_EMAIL, password },
  });
  expect(response.status(), `reviewer staging login failed: ${await response.text()}`).toBe(200);
  const body = await response.json() as { token?: string; user?: SessionAuth['user'] };
  expect(body.token).toBeTruthy();
  expect(body.user?.id).toBeTruthy();
  expect(body.user?.role).toBe('admin');
  return { token: body.token!, user: body.user! };
}

async function mutationWithRateLimitRetry(
  action: () => Promise<import('@playwright/test').APIResponse>,
) {
  let response = await action();
  for (let attempt = 0; response.status() === 429 && attempt < 4; attempt += 1) {
    const retryAfter = Number(response.headers()['retry-after'] || 1);
    await new Promise(resolve => setTimeout(resolve, Math.max(1000, Math.min(retryAfter * 1000, 5000))));
    response = await action();
  }
  return response;
}

async function retireAutomationVehicle(
  request: APIRequestContext,
  vin: string,
  sellerMutationHeaders: Record<string, string>,
) {
  // Cleanup is part of the acceptance contract. Respect the real rate limiter instead of turning
  // a transient 429 after a long lifecycle into a false contamination failure.
  const unpublish = await mutationWithRateLimitRetry(() => request.post(`${API_URL}/vehicles/${vin}/unpublish`, {
    headers: sellerMutationHeaders,
    data: {},
  }));
  expect([200, 404], `automation cleanup could not unpublish ${vin}: ${await unpublish.text()}`).toContain(unpublish.status());

  const sold = await mutationWithRateLimitRetry(() => request.patch(`${API_URL}/vehicles/${vin}/status`, {
    headers: sellerMutationHeaders,
    data: { status: 'sold' },
  }));
  expect([200, 404], `automation cleanup could not retire ${vin}: ${await sold.text()}`).toContain(sold.status());

  const discovery = await request.get(`${API_URL}/marketplace/listings?q=${encodeURIComponent(vin)}`);
  expect(discovery.status(), `automation cleanup could not verify Marketplace removal for ${vin}`).toBe(200);
  const body = await discovery.json() as { listings?: Array<{ vin?: string }> };
  expect((body.listings || []).some((listing) => listing.vin === vin), `automation vehicle ${vin} still contaminates public Marketplace`).toBe(false);
}

async function retireStaleAutomationVehicles(
  request: APIRequestContext,
  sellerAuth: SessionAuth,
  sellerMutationHeaders: Record<string, string>,
) {
  const owned = await request.get(`${API_URL}/vehicles/me`, { headers: baseHeaders(sellerAuth) });
  expect(owned.status(), 'could not inspect owned vehicles before Seller automation run').toBe(200);
  const vehicles = await owned.json() as Array<{ vin?: string; seller_description?: string | null }>;
  // Desktop and mobile projects share one staging Seller and may overlap. Retire automation from
  // OLDER workflow runs only; a sibling project from this same RUN_ID is current inventory, not
  // stale inventory, and retiring it creates a false My Listings disappearance mid-journey.
  const currentRunPrefix = `Golden Dynamic Seller ${RUN_ID}:`;
  const stale = vehicles.filter((vehicle) => {
    const description = String(vehicle.seller_description || '');
    return Boolean(vehicle.vin)
      && description.startsWith('Golden Dynamic Seller ')
      && !description.startsWith(currentRunPrefix);
  });

  for (const vehicle of stale) {
    await retireAutomationVehicle(request, vehicle.vin!, sellerMutationHeaders);
  }
}

async function expectMeaningfulRenderedImage(page: Page) {
  const image = page.getByTestId('vehicle-image').first();
  await expect(image).toBeVisible();
  // Visibility can precede image decode: wait for the browser to finish loading a genuinely
  // meaningful asset instead of sampling naturalWidth/naturalHeight during the transient 0x0 state.
  await expect.poll(
    async () => image.evaluate((node: HTMLImageElement) =>
      node.complete && node.naturalWidth >= 64 && node.naturalHeight >= 40),
    {
      timeout: 20_000,
      message: 'visual acceptance image never finished decoding at a meaningful size',
    },
  ).toBe(true);
  const size = await image.evaluate((node: HTMLImageElement) => ({
    width: node.naturalWidth,
    height: node.naturalHeight,
  }));
  expect(size.width, 'visual acceptance image is too narrow to be meaningful').toBeGreaterThanOrEqual(64);
  expect(size.height, 'visual acceptance image is too short to be meaningful').toBeGreaterThanOrEqual(40);
}

test.describe('Golden Dynamic Seller — exact-head deployed acceptance', () => {
  test('fresh Seller lifecycle holds end-to-end without a seed/reference vehicle', async ({ page, request }, testInfo) => {
    // This is a deployed-staging lifecycle across auth, storage, evidence, publication, inquiry and
    // Seller surfaces. Keep strict per-action timeouts, but do not let the suite-level 90s ceiling
    // terminate a healthy journey before its cleanup/lifecycle assertions can finish.
    test.setTimeout(180_000);
    const truth = envTruth();
    expect(truth.mode, 'Seller acceptance is not pinned to the frozen exact-head bundle').toBe('acceptance');
    expect(requireIdentity('buyer'), 'owner Seller identity is unavailable').toBe(true);
    expect(requireIdentity('reviewer'), 'reviewer identity is unavailable').toBe(true);

    const suffix = sixDigits(`${RUN_ID}-${testInfo.project.name}`);
    const vin = `JTDKARFP0H3${suffix}`;
    const newPrice = 29_000;
    let sellerMutationHeaders: Record<string, string> | null = null;
    let cleanupAuth: SessionAuth | null = null;
    let vehicleCreated = false;

    try {
    // Use the real login UI. The staging "buyer" identity is role=owner and therefore is also a
    // legitimate private Seller; no privileged role is needed to sell the owner's own vehicle.
    await signInViaUi(page, 'buyer');
    await expect(page.locator('body')).not.toContainText(/permission denied|42501/i);
    const sellerAuth = await authFromPage(page);
    cleanupAuth = sellerAuth;
    expect(sellerAuth.user.role).toBe('owner');
    sellerMutationHeaders = await mutationHeaders(request, sellerAuth);
    await retireStaleAutomationVehicles(request, sellerAuth, sellerMutationHeaders);

    // Listing media is uploaded before the vehicle exists, exactly as Seller Studio does.
    const mediaResponse = await request.post(`${API_URL}/media/upload/vehicle`, {
      headers: sellerMutationHeaders,
      data: { vin, images: VISUAL_TEST_PNGS },
    });
    expect(mediaResponse.status(), await mediaResponse.text()).toBe(200);
    const mediaBody = await mediaResponse.json() as { urls?: string[] };
    expect(mediaBody.urls).toHaveLength(7);
    expect(mediaBody.urls![0]).toMatch(/^https:\/\//);

    const photoLabels = ['Front three-quarter', 'Front', 'Driver side', 'Passenger side', 'Rear three-quarter', 'Interior', 'Dashboard'];

    const createResponse = await request.post(`${API_URL}/vehicles/add`, {
      headers: sellerMutationHeaders,
      data: {
        vin,
        make: 'Toyota',
        model: 'Hilux',
        year: 2021,
        color: 'White',
        mileage: 45_000,
        fuel_type: 'Diesel',
        transmission: 'Automatic',
        drivetrain: '4WD',
        condition: 'Used',
        seller_stated_condition: 'Used',
        category: 'Pickup',
        body_style: 'Pickup',
        description: `Golden Dynamic Seller ${RUN_ID}: one staging-only vehicle created by Playwright for exact-head acceptance.`,
        features: ['Reverse camera', 'Tow bar'],
        price: 28_500,
        currency: 'USD',
        location: 'Harare',
        province: 'Harare',
        listing_country: 'ZW',
        registration_country: 'ZW',
        location_visibility: 'public',
        public_seller_display_enabled: false,
        engine_number: `ENG-${suffix}`,
        chassis_number: `CHS-${suffix}`,
        plate_number: `UAT${suffix.slice(0, 3)}`,
        import_status: 'locally_registered',
        images: mediaBody.urls!.map((url, index) => ({
          url,
          photo_label: photoLabels[index],
          is_primary: index === 2,
        })),
      },
    });
    expect(createResponse.status(), await createResponse.text()).toBe(201);
    const created = await createResponse.json() as {
      publication_status?: string;
      images_recorded?: boolean;
      images_recorded_count?: number;
      images_unpublishable_count?: number;
      images_replacement_complete?: boolean;
      images_labels_recorded?: boolean;
      location_recorded?: boolean;
    };
    expect(created.publication_status).toBe('draft');
    expect(created.images_recorded).toBe(true);
    expect(created.images_recorded_count).toBe(7);
    expect(created.images_unpublishable_count).toBe(0);
    expect(created.images_replacement_complete).not.toBe(false);
    expect(created.images_labels_recorded).toBe(true);
    expect(created.location_recorded).toBe(true);
    vehicleCreated = true;

    // Fresh server resume must restore Seller-authored labels/order/cover from CarUp, not from
    // the browser upload payload. This page was never used to create the fixture.
    await page.goto(`/dashboard/sell-vehicle?vin=${vin}`);
    await expect(page.getByTestId('seller-server-draft-loaded')).toBeVisible({ timeout: 20_000 });
    const restoredLabelTriggers = page.getByRole('combobox', { name: /Photo \d+ angle or view/i });
    await expect(restoredLabelTriggers).toHaveCount(7);
    for (let index = 0; index < photoLabels.length; index += 1) {
      await expect(restoredLabelTriggers.nth(index)).toContainText(photoLabels[index]);
    }
    await expect(page.getByTestId('listing-media-cover-badge-2')).toBeVisible();

    // Owner convergence: the same dynamic VIN exists in Garage and My Listings.
    await page.goto('/dashboard/garage');
    await expect(page.getByTestId(`vehicle-row-${vin}`)).toBeVisible({ timeout: 20_000 });
    await page.goto('/dashboard/listings');
    const listingCard = page.getByTestId(`my-listing-card-${vin}`);
    await expect(listingCard).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`publication-badge-${vin}`)).toContainText('Draft');

    // Authenticated Buyer Preview is allowed for this Seller, but it is NOT a public listing and
    // buyer transactional controls must therefore be absent.
    await page.goto(`/marketplace/${vin}`);
    await expect(page.getByTestId('vehicle-detail-intelligence-hero')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('listing-media-primary')).toBeVisible();
    await expect(page.getByTestId('listing-media-thumb')).toHaveCount(7);
    const primaryImage = page.getByTestId('listing-media-primary').getByTestId('vehicle-image');
    await expect(primaryImage).toHaveAttribute('src', mediaBody.urls![2]);
    await expectMeaningfulRenderedImage(page);
    const coverSrc = await primaryImage.getAttribute('src');
    await page.getByTestId('listing-media-thumb').nth(1).click();
    await expect.poll(() => primaryImage.getAttribute('src'), { message: 'gallery navigation did not change the rendered image' })
      .not.toBe(coverSrc);
    await expect(page.getByTestId('marketplace-inquiry-open')).toHaveCount(0);

    // Publication must fail while the blocking ownership evidence is genuinely absent.
    const blockedPublish = await request.post(`${API_URL}/vehicles/${vin}/publish`, {
      headers: sellerMutationHeaders,
      data: {},
    });
    expect(blockedPublish.status(), 'draft published without verified ownership evidence').toBe(400);
    const blocked = await blockedPublish.json() as {
      blocking_gaps?: Array<{ key?: string; label?: string }>;
      pending_gaps?: Array<{ key?: string; label?: string }>;
      requirements?: Array<{ key?: string; label?: string; status?: string }>;
    };
    const refusalText = JSON.stringify(blocked);
    expect(refusalText).toMatch(/ownership_document|Ownership \/ Registration Document/i);

    // Upload an ownership document through the governed evidence contract.
    const evidenceResponse = await request.post(`${API_URL}/vehicles/${vin}/evidence/upload`, {
      headers: sellerMutationHeaders,
      data: {
        evidence_type: 'registration_document',
        file: EVIDENCE_TEST_PNG,
        visibility_level: 'restricted',
        verification_notes: `Golden Dynamic Seller ${RUN_ID} registration evidence`,
      },
    });
    expect(evidenceResponse.status(), await evidenceResponse.text()).toBe(201);
    const evidence = await evidenceResponse.json() as { id?: string; verification_status?: string };
    expect(evidence.id).toBeTruthy();
    expect(evidence.verification_status).toBe('pending');

    // The owner sees the real pending record in the Passport/Evidence surface.
    await page.goto(`/dashboard/garage/${vin}`);
    await expect(page.getByText(/Registration Document/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('body')).toContainText(/pending/i);

    // Review is a separate authority. Sign in through the real auth endpoint as the staging reviewer,
    // obtain a reviewer-bound CSRF token, and verify the exact evidence row.
    const reviewer = await reviewerAuth(request);
    const reviewerMutationHeaders = await mutationHeaders(request, reviewer);
    const verifyResponse = await request.patch(`${API_URL}/vehicles/${vin}/evidence/${evidence.id}/verify`, {
      headers: reviewerMutationHeaders,
      data: { notes: `Golden Dynamic Seller ${RUN_ID} verified`, trust_score_impact: 3 },
    });
    expect(verifyResponse.status(), await verifyResponse.text()).toBe(200);

    // Publish from the Seller UI, not by database/operator intervention.
    await page.goto('/dashboard/listings');
    await expect(page.getByTestId(`my-listing-card-${vin}`)).toBeVisible({ timeout: 20_000 });
    await page.getByTestId(`publish-toggle-${vin}`).click();
    await expect(page.getByTestId(`publication-badge-${vin}`)).toContainText('Published', { timeout: 20_000 });

    // Drop Seller auth and prove the VIN is genuinely public through the real Marketplace.
    await page.evaluate(() => localStorage.clear());
    // Drive the shareable Marketplace search contract directly through its governed URL state.
    // Typing into the command bar is intentionally debounced; using the URL avoids making UAT
    // timing-sensitive while still exercising the real Marketplace page + backend q filter.
    await page.goto(`/marketplace?q=${encodeURIComponent(vin)}&fixture_scope=${encodeURIComponent(RUN_ID)}`);
    await expect(page.getByTestId('marketplace-results-count')).toContainText('1', { timeout: 20_000 });
    const publicLink = page.locator(`a[href^="/marketplace/${vin}"]`).first();
    await expect(publicLink).toBeVisible({ timeout: 20_000 });
    await publicLink.click();
    await expect(page.getByTestId('vehicle-detail-primary-actions')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('listing-media-primary')).toBeVisible();
    await expectMeaningfulRenderedImage(page);

    const labelledDetailResponse = await request.get(
      `${API_URL}/marketplace/listings/${vin}?fixture_scope=${encodeURIComponent(RUN_ID)}`,
    );
    expect(labelledDetailResponse.status(), await labelledDetailResponse.text()).toBe(200);
    const labelledDetail = await labelledDetailResponse.json() as {
      listing_media?: { items?: Array<{ photo_label?: string | null; seller_order?: number | null; is_primary?: boolean }> };
    };
    const projectedItems = labelledDetail.listing_media?.items || [];
    expect(projectedItems).toHaveLength(7);
    expect(projectedItems.find(item => item.is_primary)?.photo_label).toBe('Driver side');
    expect([...projectedItems]
      .sort((a, b) => Number(a.seller_order) - Number(b.seller_order))
      .map(item => item.photo_label))
      .toEqual(photoLabels);

    // Real guest buyer intent -> governed Marketplace inquiry -> Communications bridge.
    await page.getByTestId('marketplace-inquiry-open').first().click();
    await expect(page.getByTestId('marketplace-inquiry-modal')).toBeVisible();
    await page.getByTestId('marketplace-inquiry-name').fill('Golden Dynamic Buyer');
    await page.getByTestId('marketplace-inquiry-email').fill(`golden-${suffix}@example.test`);
    await page.getByTestId('marketplace-inquiry-phone').fill('+263771234567');
    await page.getByTestId('marketplace-inquiry-message').fill(`Is ${vin} still available for inspection?`);
    const inquiryWait = page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().includes('/api/marketplace/inquiries')
    );
    await page.getByTestId('marketplace-inquiry-submit').click();
    const inquiryResponse = await inquiryWait;
    expect([200, 201]).toContain(inquiryResponse.status());
    await expect(page.getByTestId('marketplace-inquiry-modal')).toHaveCount(0, { timeout: 15_000 });

    // Return as Seller. Marketplace inquiry capture is immediate and has its own governed inbox on
    // My Listings. Communication threads are an asynchronous downstream projection and must not be
    // confused with the durable inquiry itself.
    await signInViaUi(page, 'buyer');
    cleanupAuth = await authFromPage(page);
    await page.goto('/dashboard/listings');
    const sellerCard = page.getByTestId(`my-listing-card-${vin}`);
    await expect(sellerCard).toBeVisible({ timeout: 20_000 });
    const inquiryInbox = page.getByTestId('seller-inquiries-card');
    await expect(inquiryInbox).toBeVisible({ timeout: 20_000 });
    await expect(inquiryInbox).toContainText(vin, { timeout: 20_000 });
    await expect(inquiryInbox).toContainText(`Is ${vin} still available for inspection?`, { timeout: 20_000 });

    // Seller Intelligence may have measured data OR may truthfully say it is unavailable. Both are
    // valid; rendering fabricated zeroes as a substitute for missing measurement is not.
    await page.getByTestId(`toggle-insights-${vin}`).click();
    const insights = page.getByTestId('listing-insights').or(page.getByTestId('listing-insights-unavailable'));
    await expect(insights.first()).toBeVisible({ timeout: 20_000 });

    // Price lifecycle is Seller-owned and server-persistent.
    await page.getByTestId(`change-price-${vin}`).click();
    await page.getByTestId(`price-input-${vin}`).fill(String(newPrice));
    await page.getByTestId(`price-save-${vin}`).click();
    await expect(page.getByTestId(`listing-price-${vin}`)).toContainText(/29,?000/, { timeout: 20_000 });

    // Unpublish from the Seller UI, then mark sold so the UAT vehicle is retired from active stock.
    await page.getByTestId(`publish-toggle-${vin}`).click();
    await expect(page.getByTestId(`publication-badge-${vin}`)).toContainText('Ready to publish', { timeout: 20_000 });
    await page.getByTestId(`mark-sold-${vin}`).click();
    await expect(sellerCard).toContainText(/Sold/i, { timeout: 20_000 });

    // Public Marketplace must no longer expose the retired VIN.
    await page.evaluate(() => localStorage.clear());
    await page.goto(`/marketplace?q=${encodeURIComponent(vin)}&fixture_scope=${encodeURIComponent(RUN_ID)}`);
    await expect(page.getByTestId('marketplace-results-count')).toContainText('0', { timeout: 20_000 });
    await expect(page.locator(`a[href^="/marketplace/${vin}"]`)).toHaveCount(0);

    // Keep these literal identities referenced so accidental fixture drift is caught by review.
    expect(SELLER_EMAIL).toBe('uat.buyer@carup-staging.test');
    } finally {
      if (vehicleCreated && cleanupAuth) {
        // Reuse the last real Seller session captured during the journey. Cleanup mints fresh CSRF
        // authority, but does not perform a third UI login merely to clean an already-retired fixture.
        const cleanupHeaders = await mutationHeaders(request, cleanupAuth);
        await retireAutomationVehicle(request, vin, cleanupHeaders);
      }
    }
  });
});
