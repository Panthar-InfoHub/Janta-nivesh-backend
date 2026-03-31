- GOALS :
 - Get user goals
 - Delete user goals


 MF API's :

 - https://api.mfapi.in/mf/latest 



 REDIS TODO :
 - otp verification



 //

 {
    "schemeCode": 100027,
    "schemeName": "Grindlays Super Saver Income Fund-GSSIF-Half Yearly Dividend",
    "fundHouse": "Standard Chartered Mutual Fund",
    "schemeType": "Open Ended Schemes",
    "schemeCategory": "Income",
    "isinGrowth": null,
    "isinDivReinvestment": null,
    "nav": "10.72050",
    "date": "29-05-2008"
  },


  // ---> Nav history api result


  "meta": {
    "fund_house": "SBI Mutual Fund",
    "scheme_type": "Open Ended Schemes",
    "scheme_category": "Equity Scheme - Small Cap Fund",
    "scheme_code": 125497,
    "scheme_name": "SBI Small Cap Fund - Direct Plan - Growth",
    "isin_growth": "INF200K01T51",
    "isin_div_reinvestment": null
  },
  "data": [
    {
      "date": "04-02-2026",
      "nav": "186.77740"
    },
    {
      "date": "03-02-2026",
      "nav": "186.70090"
    },
    {
      "date": "02-02-2026",
      "nav": "180.54240"
    },
    {


      Code,Income Range Description
31,Below ₹1 Lakh
32,₹1 Lakh – ₹5 Lakhs
33,₹5 Lakhs – ₹10 Lakhs
34,₹10 Lakhs – ₹25 Lakhs
35,₹25 Lakhs – ₹1 Crore
36,Above ₹1 Crore


```

              "name": "15. NEW- Generate Aadhaar Esign URL",
              "event": [
                {
                  "listen": "test",
                  "script": {
                    "exec": [
                      "let body = JSON.parse(responseBody);",
                      "",
                      "pm.environment.set('aadharEsignUrl', body.object.result.url);"
                    ],
                    "type": "text/javascript",
                    "packages": {},
                    "requests": {}
                  }
                }
              ],
              "request": {
                "method": "POST",
                "header": [
                  {
                    "key": "Content-Type",
                    "value": "application/json",
                    "type": "text"
                  },
                  {
                    "key": "Authorization",
                    "value": "{{onboardingAccessToken}}",
                    "type": "text"
                  }
                ],
                "body": {
                  "mode": "raw",
                  "raw": "{\r\n    \"arn\": \"20943\",\r\n    \"investorId\": \"3342\",\r\n    \"merchantId\": \"{{onboardingPassword}}\",\r\n    \"inputData\": {\r\n        \"service\": \"esign\",\r\n        \"type\": \"\",\r\n        \"task\": \"createEsignUrl\",\r\n        \"data\": {\r\n            \"inputFile\": \"{{combinedPdfUrl}}\",\r\n            \"signatureType\": \"aadhaaresign\",\r\n            \"redirectUrl\": \"http://acmatics.com/kyc\"\r\n        }\r\n    }\r\n}"
                },
                "url": {
                  "raw": "{{baseUrl}}/kyc/v1/onboardings/execute",
                  "host": [
                    "{{baseUrl}}"
                  ],
                  "path": [
                    "kyc",
                    "v1",
                    "onboardings",
                    "execute"
                  ]
                }
              },
              "response": []
            },
            ```



WEBHOOK : 