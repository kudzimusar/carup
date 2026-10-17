/**
 * CA-K3-AUTH-05-R4 — deployed session-authority TLS contract.
 *
 * This is the same PUBLIC Supabase Root 2021 CA committed at
 * database/certs/supabase-prod-ca-2021.crt. It is embedded in a statically imported backend module
 * so Vercel's Express lambda does not depend on an external runtime file path. The focused AUTH-05
 * test suite byte-locks this copy to the canonical repository certificate.
 *
 * SESSION_AUTH_DATABASE_URL may contain libpq SSL query parameters provisioned for CLI/native
 * clients (including sslrootcert=/var/task/...). Those parameters are removed before node-postgres
 * parses the URL so they cannot override this explicit verified TLS configuration or make pg reopen
 * a filesystem path that is absent from the lambda.
 */

export const SUPABASE_ROOT_2021_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----
`;

export const SESSION_AUTHORITY_TLS_CONTRACT = Object.freeze({
  verification: 'verify-full',
  rejectUnauthorized: true,
  trustAnchor: 'Supabase Root 2021 CA',
  trustAnchorSource: 'embedded-public-trust-anchor',
});

const SSL_QUERY_PARAMETERS = new Set([
  'ssl',
  'sslmode',
  'sslrootcert',
  'sslcert',
  'sslkey',
  'sslpassword',
  'sslcrl',
  'sslnegotiation',
]);

export function buildSessionAuthorityPoolConfig(rawConnectionString) {
  const supplied = typeof rawConnectionString === 'string' ? rawConnectionString.trim() : '';
  if (!supplied) throw new Error('SESSION_AUTHORITY/CONNECTION_STRING_REQUIRED');

  let url;
  try {
    url = new URL(supplied);
  } catch {
    throw new Error('SESSION_AUTHORITY/CONNECTION_STRING_INVALID');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('SESSION_AUTHORITY/CONNECTION_STRING_INVALID');
  }

  // Remove URL-level SSL controls because pg-connection-string otherwise gives them precedence over
  // the explicit ssl object below and may synchronously read sslrootcert from a deployment-local path.
  for (const key of [...url.searchParams.keys()]) {
    if (SSL_QUERY_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key);
  }

  return {
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: true,
      ca: SUPABASE_ROOT_2021_CA,
    },
  };
}
