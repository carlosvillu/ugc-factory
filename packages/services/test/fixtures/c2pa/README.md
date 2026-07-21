# Fixtures C2PA de TEST — NO son secretos de producción

Clave privada + cadena de certificados **autofirmados de TEST** para firmar C2PA en los tests media
del pase final (T5.5). Son los certificados de ejemplo PÚBLICOS del repo `contentauth/c2patool`
(tag `v0.9.12`, `sample/es256_certs.pem` + `sample/es256_private.key`) — la MISMA versión pineada en
`apps/worker/Dockerfile`. Están construidos para satisfacer el perfil de certificado que exige
c2patool v0.9.12 (EKU/algoritmo `es256`), por eso se reutilizan tal cual en vez de generarlos a mano
(la imagen del worker no trae `openssl`).

**Estas claves son públicas y de test — `test-not-a-secret`.** Cualquiera puede firmar C2PA con ellas;
NO acreditan a UGC Factory ni a nadie. La firma de PRODUCCIÓN usará un certificado real fuera del árbol
(nunca committeado; el repo es público AGPL-3.0). Origen:
https://github.com/contentauth/c2patool/tree/v0.9.12/sample
