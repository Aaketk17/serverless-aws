const AWS = require('aws-sdk')
const XLSX = require('xlsx')

const awsRegion = process.env.REGION
AWS.config.update({
  region: awsRegion,
})

const s3 = new AWS.S3({signatureVersion: 'v4'})
const documentClient = new AWS.DynamoDB.DocumentClient({region: awsRegion})

module.exports.createSignedUrl = async (event, context, callback) => {
  console.log('API end point for Upload file :', event)

  const bucketName = process.env.BUCKET_NAME
  const requestObject = JSON.parse(event['body'])

  const dateTime = new Date().valueOf()
  const fileName = dateTime + requestObject.fileName

  const params = {
    Bucket: bucketName,
    Fields: {
      key: fileName,
    },
    Expires: 1800,
  }

  try {
    await s3.createPresignedPost(params, (error, data) => {
      if (error) {
        console.log('Error in Creating SignedURL', error)
        const response = {
          statusCode: 500,
          body: JSON.stringify({
            message: 'Error in creating preSignedPostURL',
            Error: error,
          }),
        }
        callback(null, response)
      }
      const response = {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Signed URL created Successfully',
          URL: data,
        }),
      }
      callback(null, response)
    })
  } catch (error) {
    const response = {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error in creating SignedURL',
        Error: error,
      }),
    }
    callback(null, response)
  }
}

module.exports.migrateDataToDynamoDb = (event, context, callback) => {
  console.log('Event Object :-', JSON.stringify(event))
  console.log('Uploaded File Details', event.Records[0].s3)

  const bucketName = event.Records[0].s3.bucket.name
  const fileName = event.Records[0].s3.object.key
  const tableName = process.env.TABLE_NAME

  const extension = fileName.split('.').pop()
  console.log('Extension of File :-', extension)

  console.log(
    'Bucket Name :-',
    bucketName,
    'File Name :-',
    fileName,
    'Table Name :-',
    tableName
  )
  //CONVERT CSV TO JSON FUNCTION
  const csvToJSON = (csv) => {
    //find number of lines
    var lines = csv.split('\r')

    //delete all spaces
    for (var i = 0; i < lines.length; i++) {
      lines[i] = lines[i].replace(/\s/, '')
    }
    var result = []
    //finding column names or headers
    var headers = lines[0].split(',')

    for (var i = 1; i < lines.length; i++) {
      var obj = {}
      var currentLine = lines[i].split(',')
      for (var j = 0; j < headers.length; j++) {
        //removing if the object key has no value
        if (currentLine[j] !== '') {
          obj[headers[j].toString()] = currentLine[j]
        }
      }
      result.push(obj)
    }
    return result
  }

  s3.getObject(
    {
      Bucket: bucketName,
      Key: fileName,
    },
    (error, value) => {
      console.log('Received Value :-', value)
      if (error) {
        const response = {
          statusCode: 500,
          body: JSON.stringify({
            message: 'Error in getting Objects from S3 Bucket',
            error: error,
          }),
        }
        callback(null, response)
      }
      if (extension === 'csv') {
        console.log('CSV file Migration')
        let jsonValuesCsv = []
        var fileData = value.Body.toString('utf-8')
        jsonValuesCsv = csvToJSON(fileData)
        console.log('Data from CSV :- ' + JSON.stringify(jsonValuesCsv))
        for (var i = 0; i < jsonValuesCsv.length; i++) {
          var params = {
            TableName: tableName,
            Item: jsonValuesCsv[i],
          }
          documentClient.put(params, (error, data) => {
            if (error) {
              console.log('Error in Updating to DB :-', error)
              const response = {
                statusCode: 500,
                body: JSON.stringify({
                  message: 'Error in Updating to DynamoDB',
                  error: error,
                }),
              }
              callback(null, response)
            }
            console.log('DB update success - CSV :-', data)
            const response = {
              statusCode: 200,
              body: JSON.stringify({
                message: 'Data Updated to DynamoDB',
                error: data,
              }),
            }
            callback(null, response)
          })
        }
      } else if (extension === 'xlsx') {
        console.log('XLSX file Migration')
        let jsonValuesXlsx = []

        var workBook = XLSX.read(value.Body, {
          dateNF: 'mm/dd/yyyy',
        })
        var sheetName = workBook.SheetNames

        sheetName.forEach((y) => {
          const ws = workBook.Sheets[y]
          const values = XLSX.utils.sheet_to_json(ws, {raw: false})
          values.map((v) => {
            jsonValuesXlsx.push(v)
          })
        })
        console.log('Data from XLSX :- ' + JSON.stringify(jsonValuesXlsx))
        for (var i = 0; i < jsonValuesXlsx.length; i++) {
          var params = {
            TableName: tableName,
            Item: jsonValuesXlsx[i],
          }
          documentClient.put(params, (error, data) => {
            if (error) {
              console.log('Error in Updating to DB :-', error)
              const response = {
                statusCode: 500,
                body: JSON.stringify({
                  message: 'Error in Updating to DynamoDB',
                  error: error,
                }),
              }
              callback(null, response)
            }
            console.log('DB update success - XLSX:-', data)
            const response = {
              statusCode: 200,
              body: JSON.stringify({
                message: 'Data Updated to DynamoDB',
                error: data,
              }),
            }
            callback(null, response)
          })
        }
      }
    }
  )

  const response = {
    statusCode: 200,
    body: JSON.stringify({
      message: 'File Uploaded',
    }),
  }
  callback(null, response)
}

module.exports.readFromDynamoDB = async (event, context, callback) => {
  console.log('Triggered Event', JSON.parse(event))

  const requestObject = JSON.parse(event['body'])
  const pageSize = requestObject.pageSize
  const page = requestObject.page
  const tableName = process.env.TABLE_NAME

  console.log(
    'Table Name :-',
    tableName,
    'Page Size:-',
    pageSize,
    'Page :-',
    page
  )

  let params = {
    TableName: tableName,
    limit: page,
  }
  let dbData = []
  let results
  do {
    results = await documentClient.scan(params).promise()
    console.log('Results from Scan :-', results)

    results.Items.forEach((value) => dbData.push(value))
    params.ExclusiveStartKey = results.LastEvaluatedKey
  } while (typeof results.LastEvaluatedKey !== 'undefined')

  console.log('Retrived Data :-', dbData)
  console.log('Retrived Data Size :-', dbData.length)

  callback(null, dbData)
}
