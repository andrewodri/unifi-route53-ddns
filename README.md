# Route 53 dynamic DNS for Ubiquiti UniFi OS devices (and things with a Bash shell)

This repo contains a few barebones scripts and "playbooks" for setting up dynamic DNS via Route 53 running without having the jump through a zillion hoops or installing janky packages.

The motivation for this repo was setting up WireGuard peers between home (Ubiquiti Dream Machine Pro), a remote VPN server (barebones Debian), and router that I can travel with (OpenWRT). Since all of these devices run on networks with dynamic IP addresses, I wanted something that works and is easy enough to adapt to new gear or configuirations.

If get enough motivation to do so, I might turn this into a configurable AWS CDK repo that just deploys everything.

## For UniFi OS (i.e. Ubiquiti Dream Machine Pro)

I had intially looked at [unifios-utilities](https://github.com/unifi-utilities/unifios-utilities) to solve this problem, but it just seemed extreme overkill for this, and also seems pretty bad at persisting data and keeping up with new UniFi OS releases.

At least as of v4.0.21, UniFi OS provides a pretty UI that ultimately uses [inadyn](https://github.com/troglobit/inadyn) behind the scenes to handle dynamic DNS. The solutions here lean on the [custom dynamic DNS provider](https://github.com/troglobit/inadyn?tab=readme-ov-file#custom-ddns-providers) that is made available in the UniFi OS interface.

Follow these steps:

1. Using the AWS Console, navigate to Route 53, and get the hosted zone ID of the zone that contains the record you want to update
2. Using the AWS CLI, run the following commands: (replacing the appropriate variables of course)

```shell
USER_NAME=ddns
DDNS_HOSTNAME=subdomain.domain.tld
HOSTED_ZONE_ID=Z00000000000000000000

DDNS_POLICY_ARN=$(aws iam create-policy --policy-name AmazonRoute53DDNSChangeResourceRecordSets --output text --query 'Policy.Arn' --policy-document \
'{
  "Version": "2012-10-17",
  "Statement": [
    {   
      "Effect": "Allow",
      "Action": [
        "route53:ChangeResourceRecordSets"
      ],  
      "Resource": [
        "arn:aws:route53:::hostedzone/'${HOSTED_ZONE_ID}'"
      ],
      "Condition": {
        "ForAllValues:StringEquals":{
          "route53:ChangeResourceRecordSetsNormalizedRecordNames": [
            "'${DDNS_HOSTNAME}'"
          ],
          "route53:ChangeResourceRecordSetsRecordTypes": [
            "A"
          ],
          "route53:ChangeResourceRecordSetsActions": [
            "UPSERT"
          ]
        }
      }
    },
    { 
      "Effect": "Allow", 
      "Action": [ 
        "route53:ListHostedZonesByName"
      ], 
      "Resource": "*" 
    }
  ]   
}')

CANONICAL_USER_NAME=$(aws iam create-user --user-name "${USER_NAME}" --output text --query 'User.UserName')

aws iam attach-user-policy --user-name "${CANONICAL_USER_NAME}" --policy-arn "${DDNS_POLICY_ARN}"
aws iam create-access-key --user-name "${CANONICAL_USER_NAME}" --output text --query "join(' ', [AccessKey.AccessKeyId, AccessKey.SecretAccessKey])"
```

This will create a user account that only has permission to update the specific record that you want to update, and it will **output an access key ID and secret access key**. Make a note of these, as you will want them for later.

1. Using the AWS Console, navigate to Lambda, and click on "Create Function"
2. On the following screen, make sure the following is selected:
    * _Function name_: Whatever you want
    * _Runtime_: Node 22.x
    * _Architecture_: Whatever you want
    * _Execution role_: "Create a new role with basic Lambda permissions"; but if you know what you are doing, choose what you like knowing that we do not need anything beyond a default execution role
    * _Additional configurations_: Ensure that "Enable function URL" is checked. Ensure that "Auth type" is is NONE. Ensure that "Configure cross-origin resource sharing (CORS)" is checked.
3. Click "Create Function"
4. Dump the contents of `./route53.js` into the `index.mjs` editor, and click "Deploy"
5. Take note of the value of "**Function URL**"

This this uses the Node crypto module to sign and make a request to Route 53 using the credentials we just set up as HTTP basic authentication sent to the Lambda function. The great thing about that is that we don't need any special roles configured in IAM, any NPM packages to be to be deployed, or API Gateway/CloudFront/VPC resources; we just need a plain old Lambda function with a URL.

In UniFI OS, do the following:

1. Navigate to Network > Settings > Internet, and click on the WAN connection that want to enable dynamic DNS for
2. Click on "Create New Dynamic DNS", and  make sure the following is selected/entered:
    * _Service_: Custom
    * _Hostname_: The hostname of the Lambda URL (e.g. `hash.lambda-url.us-east-1.on.aws`)
    * _Username_: The access key ID of the user we previously created
    * _Password_: The secret access key of the user we previously created
    * _Server_: A string with the following format: _[lambda-url-hostname]_?hostedZoneId=_[hosted-zone-id]_&hostname=_[ddns-hostname]_&ip=%i (e.g. Using the sample values from this readme, the server would be `hash.lambda-url.us-east-1.on.aws/?hostedZoneId=Z00000000000000000000&hostname=subdomain.domain.tld&ip=%i`)
3. Click "Save"

You should be good to go! "But how do I know if it's working?" you may ask, since it's not going to do anything unless thre actual WAN IP address changes. To validate your configuration, do the following:

1. [Enable and open an SSH shell](https://help.ui.com/hc/en-us/articles/204909374-UniFi-Connect-with-Debug-Tools-SSH) to your UniFi OS device
1. Save the path of the inadyn config to a variable: `export INADYN_CONFIG=$(ps aux | sed -n 's|.*\/usr\/sbin\/inadyn.*\(/run/\w*\)|\1|p')`
2. Changes made in the UI take a little while to update, so run this until you see the values you entered: `cat "${INADYN_CONFIG}"`
3. This command will force a dynamic DNS request, and will provide verbose debug output: `inadyn -n -1 -l debug --force -f "${INADYN_CONFIG}"`

## For Bash script with minimal dependencies (e.g. OpenWRT)

I'll hopefully get around to adding some documentation for setting up a persistent cron job, but for now, `./route53.sh` should get you 90% of the way.

Just keep in mind that there are still some dependencies; although, if you can't find them for your platform, you have bigger problems:

* [coreutils](https://www.gnu.org/software/coreutils/) (for date and hash)
* [curl](https://curl.se/)
* [openssl](https://openssl.org/)
