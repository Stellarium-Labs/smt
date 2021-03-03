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

import workerpool from 'workerpool'
import qe from './query-engine.mjs'

console.log('Init worker')

// The DB used to initialize the engine.
function lasyInit(dbFileName) {
  if (qe.dbFileName) return
  qe.init(dbFileName)
}

// Create a worker and register public functions
workerpool.worker({
  query: function (...params) { lasyInit(params.shift()); return qe.query(...params) },
  getHipsTile: function (...params) { lasyInit(params.shift()); return qe.getHipsTile(...params) },
})
