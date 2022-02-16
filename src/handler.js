const AWS = require('aws-sdk')
const XLSX = require('xlsx')

const awsRegion = process.env.REGION
AWS.config.update({
  region: awsRegion,
})

const s3 = new AWS.S3({signatureVersion: 'v4'})
const documentClient = new AWS.DynamoDB.DocumentClient({region: awsRegion})

module.exports.createSignedUrl = async (event, context, callback) => {
  console.log('Create Signed URL Event Trigger :- ', event)

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
      statusCode: 400,
      body: JSON.stringify({
        message: 'Error in creating SignedURL',
        Error: error,
      }),
    }
    callback(null, response)
  }
}

module.exports.migrateDataToDynamoDb = (event, context, callback) => {
  console.log('Migrate Event Trigger :- ', event)
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
  console.log('Read Event Trigger :- ', event)

  const requestObject = JSON.parse(event['body'])
  const page = requestObject.page
  const pageSize = requestObject.pageSize

  const tableName = process.env.TABLE_NAME

  console.log(
    'Table Name :-',
    tableName,
    'page :-',
    page,
    'pageSize :-',
    pageSize
  )

  let params = {
    TableName: tableName,
  }
  let dbData = []
  let values = {}
  let results

  do {
    results = await documentClient.scan(params).promise()
    console.log('Results from Scan :-', results)

    results.Items.forEach((value) => dbData.push(value))
    params.ExclusiveStartKey = results.LastEvaluatedKey
  } while (typeof results.LastEvaluatedKey !== 'undefined')

  values['Item'] = dbData

  console.log('Retrived Data :-', dbData)
  console.log('Retrived Data Object :-', values)
  console.log('Retrived Data Size :-', dbData.length)

  const pagination = (model, page, size) => {
    const startIndex = (page - 1) * size
    const endIndex = page * size

    const values = {}

    if (endIndex < dbData.length) {
      values.Next = {
        Page: page + 1,
        Size: pageSize,
      }
    }

    if (startIndex > 0) {
      values.Previous = {
        Page: page - 1,
        Size: pageSize,
      }
    }

    values.Items = model.slice(startIndex, endIndex)

    return values
  }

  const paginationResults = pagination(dbData, page, pageSize)

  const response = {
    statusCode: 200,
    body: JSON.stringify({
      Message: 'Data received from DynamoDB',
      TotalDataCount: dbData.length,
      PaginatedDataCount: paginationResults.Items.length,
      PaginatedData: paginationResults,
    }),
  }

  callback(null, response)
}

module.exports.updateDynamoDbData = async (event, context, callback) => {
  console.log('Update Event Trigger :- ', event)

  const requestObject = JSON.parse(event['body'])
  const tableName = process.env.TABLE_NAME
  const updateId = event.pathParameters.id
  const quantity = requestObject.quantity
  const country = requestObject.country
  const unitPrice = requestObject.unitPrice

  console.log(
    'Table Name :-',
    tableName,
    'Update ID :-',
    updateId,
    'Quantity :-',
    quantity,
    'County :-',
    country,
    'UnitPrice :-',
    unitPrice
  )

  if (
    quantity === undefined ||
    country === undefined ||
    unitPrice === undefined
  ) {
    const response = {
      statusCode: 404,
      body: JSON.stringify({
        Message: `Updating Data with StockID ${updateId} is missing parameters`,
      }),
    }
    callback(null, response)
  } else {
    const params = {
      TableName: tableName,
      Key: {
        StockCode: updateId,
      },
      UpdateExpression:
        'set #quantity = :quantity, #country = :country, #unitPrice = :unitPrice',
      ExpressionAttributeNames: {
        '#quantity': 'Quantity',
        '#country': 'Country',
        '#unitPrice': 'UnitPrice',
      },
      ExpressionAttributeValues: {
        ':quantity': quantity,
        ':country': country,
        ':unitPrice': unitPrice,
      },
      ReturnValues: 'UPDATED_NEW',
    }
    try {
      const updatedResults = await documentClient.update(params).promise()
      const response = {
        statusCode: 200,
        body: JSON.stringify({
          Message: `Data with StockID ${updateId} successfully Updated with the new given values`,
          Results: updatedResults,
        }),
      }
      console.log('Updated Results :-', updatedResults)
      callback(null, response)
    } catch (error) {
      const response = {
        statusCode: 400,
        body: JSON.stringify({
          Message: `Error in Updating Data with StockID ${updateId}`,
          Error: error,
        }),
      }
      console.log('Error in Updating :-', error)
      callback(null, response)
    }
  }
}

module.exports.deleteDynamoDbData = async (event, context, callback) => {
  console.log('Delete Event Trigger :- ', event)

  const tableName = process.env.TABLE_NAME
  const deletionId = event.pathParameters.id

  console.log('Table Name :-', tableName, 'Deletion ID :-', deletionId)

  const params = {
    TableName: tableName,
    Key: {
      StockCode: deletionId,
    },
  }

  try {
    const deletedResult = await documentClient.delete(params).promise()
    const response = {
      statusCode: 200,
      body: JSON.stringify({
        Message: `Data with StockID ${deletionId} successfully deleted`,
        Results: deletedResult,
      }),
    }
    console.log('Deletion Success :-', deletedResult)
    callback(null, response)
  } catch (error) {
    const response = {
      statusCode: 400,
      body: JSON.stringify({
        Message: `Error in Deleting Data with StockID ${deletionId}`,
        Error: error,
      }),
    }
    console.log('Error in Deleting Data :-', error)
    callback(null, response)
  }
}
