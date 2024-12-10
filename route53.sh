#!/usr/bin/env bash
IFS=$'\n\t'

# See https://docs.aws.amazon.com/Route53/latest/APIReference/requests-rest-overview.html

RECORD_NAME="subdomain.domain.tld"
RECORD_TYPE="A"
RECORD_TTL=60
RECORD_VALUE="$(curl -sSL https://checkip.amazonaws.com/)"
HOSTED_ZONE="Z00000000000000000000"

AWS_ACCESS_KEY_ID=''
AWS_SECRET_ACCESS_KEY=''
AWS_REGION='us-east-1'
AWS_SERVICE='route53'

console() { echo -e "\033[32m[${1}]\033[0m ${2}"; }
hash() { echo -en "${1}" | openssl dgst -sha256 | sed 's/^.* //'; }
sign_with_plain() { echo -en "${1}" | openssl dgst -hex -sha256 -hmac "${2}" | sed 's/^.* //'; }
sign_with_hex() { echo -en "${1}" | openssl dgst -hex -sha256 -mac HMAC -macopt "hexkey:${2}" | sed 's/^.* //'; }

# See https://docs.aws.amazon.com/Route53/latest/APIReference/API_ChangeResourceRecordSets.html

if [[ ! ${RECORD_VALUE} =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]
then
  console "public-ip-address" "invalid"
  console "message" "${RECORD_VALUE}"
  exit 1
fi

# Double quotes without escaped newlines omits newlines; mismatches occur when
# newlines are present for some reason that I can;t be bothered debugging 
# right now...

PAYLOAD="<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<ChangeResourceRecordSetsRequest xmlns=\"https://route53.amazonaws.com/doc/2013-04-01/\">
<ChangeBatch>
   <Changes>
      <Change>
         <Action>UPSERT</Action>
         <ResourceRecordSet>
            <Name>${RECORD_NAME}.</Name>
            <Type>${RECORD_TYPE}</Type>
            <TTL>${RECORD_TTL}</TTL>
            <ResourceRecords>
               <ResourceRecord>
                  <Value>${RECORD_VALUE}</Value>
               </ResourceRecord>
            </ResourceRecords>
         </ResourceRecordSet>
      </Change>
   </Changes>
</ChangeBatch>
</ChangeResourceRecordSetsRequest>"

REQUEST_DATETIME="$(date --utc +%Y%m%dT%H%M%SZ)"
REQUEST_DATE="$(date --utc +%Y%m%d)"
SIGNED_HEADERS="host;x-amz-content-sha256;x-amz-date"
HASHED_PAYLOAD=$(hash "${PAYLOAD}")
CANONICAL_REQUEST="POST\n/2013-04-01/hostedzone/${HOSTED_ZONE}/rrset/\n\nhost:route53.amazonaws.com\nx-amz-content-sha256:${HASHED_PAYLOAD}\nx-amz-date:${REQUEST_DATETIME}\n\n${SIGNED_HEADERS}\n${HASHED_PAYLOAD}"

console "public-ip-address" "${RECORD_VALUE}"
console "payload" "${PAYLOAD}"
console "request-datetime" "${REQUEST_DATETIME}"
console "hashed-payload" "${HASHED_PAYLOAD}"
console "canonical-request" "${CANONICAL_REQUEST}"

CREDENTIAL_SCOPE="${REQUEST_DATE}/${AWS_REGION}/${AWS_SERVICE}/aws4_request"
STRING_TO_SIGN="AWS4-HMAC-SHA256\n${REQUEST_DATETIME}\n${CREDENTIAL_SCOPE}\n$(hash "${CANONICAL_REQUEST}")"

console "string-to-sign" "${STRING_TO_SIGN}"

DATE_KEY=$(sign_with_plain "${REQUEST_DATE}" "AWS4${AWS_SECRET_ACCESS_KEY}")
DATE_REGION_KEY=$(sign_with_hex "${AWS_REGION}" "${DATE_KEY}")
DATE_REGION_SERVICE_KEY=$(sign_with_hex "${AWS_SERVICE}" "${DATE_REGION_KEY}")
SIGNING_KEY=$(sign_with_hex "aws4_request" "${DATE_REGION_SERVICE_KEY}")
SIGNATURE=$(sign_with_hex "${STRING_TO_SIGN}" "${SIGNING_KEY}")

AUTHORIZATION="AWS4-HMAC-SHA256 Credential=${AWS_ACCESS_KEY_ID}/${CREDENTIAL_SCOPE}, SignedHeaders=${SIGNED_HEADERS}, Signature=${SIGNATURE}"

console "signature" "${SIGNATURE}"
console "authorization" "${AUTHORIZATION}"

HTTP_STATUS_CODE=$(
  curl \
  -s \
  -w "%{http_code}" \
  -o /dev/null \
  -X "POST" \
  -H "Authorization: ${AUTHORIZATION}" \
  -H "Host: route53.amazonaws.com" \
  -H "X-Amz-Content-Sha256: ${HASHED_PAYLOAD}" \
  -H "X-Amz-Date: ${REQUEST_DATETIME}" \
  -d "${PAYLOAD}" \
  "https://route53.amazonaws.com/2013-04-01/hostedzone/${HOSTED_ZONE}/rrset/"
)

console "http-status-code" "${HTTP_STATUS_CODE}"

if [ "${HTTP_STATUS_CODE}" -ge "200" ] && [ "${HTTP_STATUS_CODE}" -lt "400" ]
then
  exit 0
else
  exit 1
fi
