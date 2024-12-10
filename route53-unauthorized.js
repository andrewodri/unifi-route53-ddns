import { Route53Client, ChangeResourceRecordSetsCommand } from '@aws-sdk/client-route-53';

export const handler = async ( event ) => {
  console.log( JSON.stringify( event, null, 2 ) );

  const { hostedZoneId, hostname, ip } = event.queryStringParameters ?? {};
  const recordType = 'A';
  const recordTtl = 60;

  const client = new Route53Client();

  const command = new ChangeResourceRecordSetsCommand( {
    ChangeBatch: { 
      Changes: [
        { 
          Action: 'UPSERT',
          ResourceRecordSet: { 
            Name: `${ hostname }.`,
            ResourceRecords: [ { Value: ip } ],
            Type: recordType,
            TTL: recordTtl,
          }
        }
      ]
    },
    HostedZoneId: hostedZoneId,
  } );

  const response = await client.send( command );

  console.log( JSON.stringify( response, null, 2 ) );

  return { statusCode: 200, body: 'success' };
};
