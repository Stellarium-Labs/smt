// Stellarium Web - Copyright (c) 2021 - Stellarium Labs SAS
//
// This program is licensed under the terms of the GNU AGPL v3, or
// alternatively under a commercial licence.
//
// The terms of the AGPL v3 license can be found in the main directory of this
// repository.
//
// This file is part of the Survey Monitoring Tool plugin, which received
// funding from the Centre national d'études spatiales (CNES).


import QueryEngine from './query-engine.mjs'
import geo_utils from './geojson-utils.mjs'

// Allow to catch CTRL+C when runnning inside a docker
process.on('SIGINT', () => {
  console.info("User Interrupted")
  process.exit(0)
})

const __dirname = process.cwd()
const dbFileName = __dirname + '/qe.db'

// Initialize the read-only engine
const qe = new QueryEngine(dbFileName)

const queries = [
  {"constraints":[],"groupingOptions":[{"operation":"GROUP_ALL"}],"aggregationOptions":[{"operation":"COUNT","out":"total"}]},
  {"constraints":[],"groupingOptions":[{"operation":"GROUP_ALL"}],"aggregationOptions":[{"operation":"VALUES_AND_COUNT","fieldId":"FieldType","out":"tags"}]},
  {"constraints":[],"groupingOptions":[{"operation":"GROUP_ALL"}],"aggregationOptions":[{"operation":"VALUES_AND_COUNT","fieldId":"TelescopeName","out":"tags"}]},
  {"constraints":[],"groupingOptions":[{"operation":"GROUP_ALL"}],"aggregationOptions":[{"operation":"VALUES_AND_COUNT","fieldId":"InputsStatus","out":"tags"}]},
  {"constraints":[],"groupingOptions":[{"operation":"GROUP_ALL"}],"aggregationOptions":[{"operation":"VALUES_AND_COUNT","fieldId":"SurveyId","out":"tags"}]},
  {"constraints":[],"groupingOptions":[{"operation":"GROUP_ALL"}],"aggregationOptions":[{"operation":"GEO_UNION_AREA","out":"area"}]}
]

for (let i in queries) {
  const start = new Date()
  const res = qe.query(queries[i])
  if (i == 5) console.log('Area = ' + res.res[0].area * geo_utils.STERADIAN_TO_DEG2)
  if (i == 6) {
    for (const k in res.res[0].hist) console.log(k + ': ' + res.res[0].hist[k] * geo_utils.STERADIAN_TO_DEG2)
  }
  console.log('query %d: %d ms', i, new Date() - start)
}
QueryEngine.deinit()
