import { Hash } from "@aws-sdk/hash-node";
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { HttpRequest } from '@aws-sdk/protocol-http';

// The packages above are deprecated... I'll replace them with the native 
// crypto methods and just do what the bash script is doing; it'll prolly be 
// smaller and faster too

class Sha256 {
  constructor( secret ) { this.hash = new Hash( 'sha256', secret ) }
  update( data ) { this.hash.update( convertToBuffer( data )) }
  digest() { return this.hash.digest() }
  reset() { this.hash.reset() }
}

function convertToBuffer(data) {
  if ( data instanceof Uint8Array ) return data;
  if ( typeof data === 'string' ) return Buffer.from( input, 'utf8' );
  if ( ArrayBuffer.isView( data ) ) return new Uint8Array( data.buffer, data.byteOffset, data.byteLength / Uint8Array.BYTES_PER_ELEMENT );
  return new Uint8Array( data );
}

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

  const signer = new SignatureV4( {
    service: 'route53',
    region: 'us-east-1',
    sha256: Sha256,
    credentials: {
      accessKeyId: username,
      secretAccessKey: password,
    },
  } );

  const httpRequest = new HttpRequest( {
    method: 'POST',
    protocol: 'https:',
    path: `/2013-04-01/hostedzone/${ hostedZoneId }/rrset/`,
    headers: {
      host: 'route53.amazonaws.com',
    },
    hostname: 'route53.amazonaws.com',
    body: payload,
  } );

  const signedRequest = await signer.sign( httpRequest, { signingDate: new Date() } );

  console.log( JSON.stringify( signedRequest, null, 2 ) );

  try {
    await fetch( `https://route53.amazonaws.com/2013-04-01/hostedzone/${ hostedZoneId }/rrset/`, signedRequest );

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
