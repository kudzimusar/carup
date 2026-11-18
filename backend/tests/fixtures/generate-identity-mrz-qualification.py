"""Render fictional TD3 fixtures. Requires Pillow and the pinned SIL OFL OCR-B font."""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_SHA256 = "367d876cca948ecd4900851f6e85687cbb6e71de9d0d2f36348edec5655526af"
ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def digit(value):
    return str(sum((0 if char == "<" else ALPHABET.index(char)) * (7, 3, 1)[index % 3]
                   for index, char in enumerate(value)) % 10)


def td3(surname, names, number, birth, expiry, optional):
    header = ("P<UTO" + surname + "<<" + names)[:44].ljust(44, "<")
    optional = optional.ljust(14, "<")
    lower = number + digit(number) + "UTO" + birth + digit(birth) + "F" + expiry + digit(expiry) + optional + digit(optional)
    return header, lower + digit(lower[:10] + lower[13:20] + lower[21:43])


def render(font, lines, background, position, size):
    image = Image.new("RGB", (1800, 880), background)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1800, 118), fill="#e8eef4")
    draw.text((60, 34), "SYNTHETIC TEST ONLY / NOT AN ID", fill="#14293c", font=ImageFont.truetype(font, 30))
    draw.text((60, 170), "FICTIONAL OCR QUALIFICATION FIXTURE", fill="#243440", font=ImageFont.truetype(font, 24))
    typeface = ImageFont.truetype(font, size)
    left, top, gap = position
    while max(typeface.getlength(line) for line in lines) + left >= image.width - 24:
        size -= 1
        typeface = ImageFont.truetype(font, size)
    for index, line in enumerate(lines):
        draw.text((left, top + gap * index), line, font=typeface, fill="#161a20")
    return image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("ocr_b_font", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    assert hashlib.sha256(args.ocr_b_font.read_bytes()).hexdigest() == FONT_SHA256, "Unexpected font bytes"
    font = str(args.ocr_b_font)
    args.output.mkdir(parents=True, exist_ok=True)
    entries = []

    def save(name, group, truth, image, lines=None, ext="png"):
        path = args.output / (name + "." + ext)
        image.save(path, **({"quality": 59, "subsampling": 1} if ext == "jpg" else {}))
        entries.append({"file": path.name, "group": group, "expected": truth,
                        "lines": list(lines) if lines else None,
                        "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})

    development = [
        ("MARI", "RITA<AMA", "AM5178134", "851013", "331207", ""),
        ("BANDA", "TARIRO<AMA", "CF4488413", "921211", "340928", ""),
        ("ERIKSSON", "ANNA<MARIA", "L898902C3", "740812", "120415", "ZE184226B"),
        ("DEMO<TEST", "TARIRO<LINDA<AMA", "LE6626915", "881119", "360211", "AXF672435Z7123"),
    ]
    holdout = [
        ("SYNTHETICTEST", "MARIANA<CLAIRE<CECILIA<ANN", "EK3276189", "910417", "320714", "DMF935631XCZ93"),
        ("MOCK<EXAMPLE", "JULIANA<MARIE<ELIZABETH<ANN", "AH3785915", "890316", "340921", "53961872463917"),
        ("MAKEME", "CLARA<MARIANA<HELENA<ELIZA<ANN", "CE5924367", "930828", "401009", "13564827319874"),
        ("BATCH<CONTROL", "MARIEL<ERICA<CHANTAL<MARIE", "NM4571938", "990528", "380522", "12374895673214"),
        ("RANDOMROW", "ANA<AMELIA<CATHERINE<MARINA", "CF6735491", "950718", "371216", "56183927514836"),
        ("TEST<CONTROL", "JOSEPHINE<CLARA<EMMA<CECILE", "AC3947162", "961103", "340528", "35124867961352"),
        ("EXAMPLE", "MICAELA<ANA<TARIRO<CECILIA", "ND3854627", "881220", "350421", "HFG568A43NN82Q"),
        ("FICTIVE<ROW", "TERESA<AMELIA<CARINA<MARIA", "FE6483725", "970521", "400911", "94726135981723"),
    ]
    layouts = [
        ("#fff", (47, 634, 87), 48, "png"),
        ("#ece6d9", (97, 620, 92), 44, "png"),
        ("#f0f2f7", (134, 632, 83), 40, "jpg"),
        ("#fff", (62, 594, 114), 46, "png"),
    ]
    for group, rows in (("development", development), ("holdout", holdout)):
        for index, row in enumerate(rows):
            lines = td3(*row)
            bg, position, size, ext = layouts[index % len(layouts)]
            save(f"{group}-{index+1:02}", group, "valid", render(font, lines, bg, position, size), lines, ext)

    lines = td3(*holdout[1])
    wrong = lines[1][:9] + str((int(lines[1][9]) + 1) % 10) + lines[1][10:]
    row_image = lambda rows: render(font, rows, "#fff", (70, 635, 88), 45)
    base = row_image(lines)
    save("invalid-check-digit", "negative", "invalid", row_image((lines[0], wrong)), (lines[0], wrong))
    save("missing-second-line", "negative", "partial", row_image((lines[0],)))
    save("cut-second-line", "negative", "partial", row_image((lines[0], lines[1][:35])))
    save("reversed-line-order", "negative", "order", row_image(lines[::-1]))
    save("blur", "challenge", "degraded", base.filter(ImageFilter.GaussianBlur(8)), lines)
    save("rotation", "challenge", "degraded", base.rotate(90, expand=True), lines)
    save("low-resolution", "challenge", "degraded", base.resize((240, 134), Image.Resampling.BOX), lines)
    save("blank", "negative", "non_document", Image.new("RGB", base.size, "white"))
    diagram = Image.new("RGB", base.size, "#efeee9")
    draw = ImageDraw.Draw(diagram)
    for index, color in enumerate(("#47698b", "#7d4a52", "#688d64", "#c4a16b")):
        draw.ellipse((90 + 344 * index, 580, 320 + 344 * index, 810), fill=color)
    save("non-document-color-chart", "negative", "non_document", diagram)
    save("literal-field-labels", "negative", "non_document", row_image(("PASSPORT NUMBER: SYNTHETIC345", "DATE OF BIRTH: 1995-01-02")))
    (args.output / "ground-truth.json").write_text(json.dumps(entries, indent=2) + "\n")


if __name__ == "__main__":
    main()
