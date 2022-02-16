const AWS = require('aws-sdk')
AWS.config.update({
  region: 'us-east-2',
  accessKeyId: 'AKIA5CS6B6UPHFORXRJ5',
  secretAccessKey: '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',
})
const documentClient = new AWS.DynamoDB.DocumentClient({region: 'us-east-2'})

const check = async () => {
  const page = 2
  const pageSize = 100

  let params = {
    TableName: 'CsvToDynamoDB',
  }
  let dbData = []
  // let values = {}
  let results

  do {
    results = await documentClient.scan(params).promise()

    results.Items.forEach((value) => dbData.push(value))
    params.ExclusiveStartKey = results.LastEvaluatedKey
  } while (typeof results.LastEvaluatedKey !== 'undefined')

  // values['Item'] = dbData

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

  console.log('Retrived Data :-', paginationResults)
}

check()
