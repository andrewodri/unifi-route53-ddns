import crypto from 'node:crypto';

const sha256 = ( value ) => crypto.createHash( 'sha256' ).update( value ).digest( 'hex' );

const hmac = ( value, key, encoding ) => crypto.createHmac( 'sha256', key ).update( value ).digest( encoding );

export const handler = async ( event ) => {
  const { authorization } = event.headers ?? {};

  if ( ! authorization?.startsWith( 'Basic ' ) ) return { statusCode: 403 };

  const [ username, password ] = atob( authorization.slice( 6 ) ).split( ':' );

  if ( ! username || ! password ) return { statusCode: 403 };

  const { hostedZoneId, hostname, ip } = event.queryStringParameters ?? {};
  const recordType = 'A';
  const recordTtl = 60;

  const payload = `<?xml version="1.0" encoding="UTF-8"?>
<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
<ChangeBatch>
    <Changes>
      <Change>
          <Action>UPSERT</Action>
          <ResourceRecordSet>
            <Name>${ hostname }.</Name>
            <Type>${ recordType }</Type>
            <TTL>${ recordTtl }</TTL>
            <ResourceRecords>
                <ResourceRecord>
                  <Value>${ ip }</Value>
                </ResourceRecord>
            </ResourceRecords>
          </ResourceRecordSet>
      </Change>
    </Changes>
</ChangeBatch>
</ChangeResourceRecordSetsRequest>`;

  const date = new Date();
  const dateMedium = date.toJSON().replace( /(-|:|\.\d{3})/g, '' );
  const dateShort = date.toJSON().replace( /(-|T.+$)/g, '' );

  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const hashedPayload = sha256( payload );
  const canonicalRequest = `POST\n/2013-04-01/hostedzone/${ hostedZoneId }/rrset/\n\nhost:route53.amazonaws.com\nx-amz-content-sha256:${ hashedPayload }\nx-amz-date:${ dateMedium }\n\n${ signedHeaders }\n${ hashedPayload }`;
  const hashedRequest = sha256( canonicalRequest );

  const credentialScope = `${ dateShort }/${ process.env.AWS_REGION }/route53/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${ dateMedium }\n${ credentialScope }\n${ hashedRequest }`;

  const dateKey = hmac( dateShort, `AWS4${ password }` );
  const regionKey = hmac( process.env.AWS_REGION, dateKey );
  const serviceKey = hmac( 'route53', regionKey );
  const signingKey = hmac( 'aws4_request', serviceKey );
  const signature = hmac( stringToSign, signingKey, 'hex' );

  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${ username }/${ credentialScope }, SignedHeaders=${ signedHeaders }, Signature=${ signature }`

  try {
    await fetch( `https://route53.amazonaws.com/2013-04-01/hostedzone/${ hostedZoneId }/rrset/`, {
      method: 'POST',
      headers: {
        authorization: authorizationHeader,
        host: 'route53.amazonaws.com',
        'x-amz-date': dateMedium,
        'x-amz-content-sha256': hashedPayload,
      },
      body: payload,
    } );

    return {
      statusCode: 200,
      body: 'success',
    };
  } catch (e) {
    console.log( JSON.stringify( e, null, 2 ) );

    return {
      statusCode: 500,
      body: JSON.stringify( e ),
    };
  }
};
