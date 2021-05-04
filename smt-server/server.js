// Stellarium Web - Copyright (c) 2020 - Stellarium Labs SAS
//
// This program is licensed under the terms of the GNU AGPL v3, or
// alternatively under a commercial licence.
//
// The terms of the AGPL v3 license can be found in the main directory of this
// repository.
//
// This file is part of the Survey Monitoring Tool plugin, which received
// funding from the Centre national d'études spatiales (CNES).

import express from 'express'
import cors from 'cors'
import fsp from 'fs/promises'
import fs from 'fs'
import _ from 'lodash'
import QueryEngine from './query-engine.mjs'
import bodyParser from 'body-parser'
import NodeGit from 'nodegit'
import hash_sum from 'hash-sum'

const SMT_VERSION = process.env.npm_package_version || 'dev'
const DATA_GIT_SERVER = 'git@github.com:Stellarium-Labs/smt-data.git'
const DATA_GIT_BRANCHES = ['main', 'reprocessing', 'integration']

console.log('Starting SMT Server ' + SMT_VERSION + ' on branches ' + DATA_GIT_BRANCHES)

const app = express()
app.use(cors())
app.use(bodyParser.json())         // to support JSON-encoded bodies

// Allow to catch CTRL+C when runnning inside a docker
process.on('SIGINT', () => {
  console.info("User Interrupted")
  process.exit(0)
})

const port = process.env.PORT || 8100
const __dirname = process.cwd()

const getSmtServerSourceCodeHash = async function () {
  let extraVersionHash = ''
  try {
    extraVersionHash = await fsp.readFile(__dirname + '/extraVersionHash.txt', 'utf-8')
    extraVersionHash = extraVersionHash.trim()
  } catch (err) {
    console.log('No extraVersionHash.txt file found, try to generate one from git status')
    // Check if this server is in a git and if it has modifications, generate
    // an extraVersionHash on the fly
    try {
      const repo = await NodeGit.Repository.open(__dirname + '/..')
      const commit = await repo.getHeadCommit()
      const statuses = await repo.getStatus()
      const serverCodeGitSha1 = await commit.sha()
      let modified = false
      statuses.forEach(s => { if (s.isModified()) modified = true })
      extraVersionHash = serverCodeGitSha1
      if (modified) {
        console.log('Server code has local modifications')
        extraVersionHash += '_' + Date.now()
      }
    } catch (err) {
      // This server is not in a git, just give up and return empty string
    }
  }
  return extraVersionHash
}
const smtServerSourceCodeHash = await getSmtServerSourceCodeHash()

const syncGitData = async function (gitServer, gitBranch) {
  const localPath = __dirname + '/data'
  const cloneOptions = {
    fetchOpts: {
      callbacks: {
        certificateCheck: function() { return 0 },
        credentials: function(url, userName) {
          if (fs.existsSync(__dirname + '/access_key.pub')) {
            return NodeGit.Cred.sshKeyNew(
              userName,
              __dirname + '/access_key.pub',
              __dirname + '/access_key', '')
          } else {
            return NodeGit.Cred.sshKeyFromAgent(userName)
          }
        }
      }
    }
  }
  console.log('Synchronizing with SMT data git repo: ' + gitServer)
  const repo = await NodeGit.Clone(gitServer, localPath, cloneOptions)
    .catch(err => {
      console.log('Repo already exists, use local version from ' + localPath)
      return NodeGit.Repository.open(localPath)
    })
  await repo.fetchAll(cloneOptions.fetchOpts)
  console.log('Getting to last commit on branch ' + gitBranch)
  const ref = await repo.getBranch('refs/remotes/origin/' + gitBranch)
  await repo.checkoutRef(ref)
  const commit = await repo.getHeadCommit()
  const statuses = await repo.getStatus()
  const ret = {}
  ret.dataGitSha1 = await commit.sha()
  ret.dataLocalModifications = false
  statuses.forEach(s => { if (s.isModified()) ret.dataLocalModifications = true })

  // Compute the base hash key which is unique for a given version of the server
  // code and data. It will be used to generate cache-friendly URLs.
  let baseHashKey = ret.dataGitSha1 + smtServerSourceCodeHash

  if (ret.dataLocalModifications) {
    console.log('Data has local modifications')
    baseHashKey += '_' + Date.now()
  }
  ret.baseHashKey = hash_sum(baseHashKey)

  ret.version = SMT_VERSION
  ret.dataGitServer = gitServer
  ret.dataGitBranch = gitBranch
  return ret
}

const BRANCH_DATA = {}
for (let b of DATA_GIT_BRANCHES) {
  BRANCH_DATA[b] = {
    status: 'starting',
    // Name of the SQLite DB file
    dbFileName: __dirname + '/qe-' + b + '.db',
    // Query engine instance for this branch
    qe: undefined,
    // Base hash key for this branche used to generate cache-friendly URLs
    BASE_HASH_KEY: '',
    // Global storage of hash -> query for later lookup
    hashToQuery: {}
  }
}

// Start listening to connection even during startup
app.listen(port, () => {
  console.log(`SMT Server listening at http://localhost:${port}`)
})

app.get('/api/v1/branches', (req, res) => {
  res.send({branches: DATA_GIT_BRANCHES})
})

app.get('/api/v1/:branch/status', (req, res) => {
  const branchData = BRANCH_DATA[req.params.branch]
  if (!branchData) {
    res.status(404).send()
    return
  }
  res.send({status: branchData.status})
})

const reSyncData = async function () {
  for (let b of DATA_GIT_BRANCHES) {
    await reSyncDataForBranch(b)
  }
}

const reSyncDataForBranch = async function (branch) {
  const branchData = BRANCH_DATA[branch]
  branchData.status = 'syncing data'
  const newServerInfo = await syncGitData(DATA_GIT_SERVER, branch)

  // Check if we can preserve the previous DB to avoid re-loading the whole DB
  let reloadGeojson = true
  try {
    const dbServerInfo = QueryEngine.getDbExtraInfo(branchData.dbFileName)
    if (dbServerInfo && fs.existsSync('dontReloadGeojson')) {
      reloadGeojson = false
    }
    if (dbServerInfo && dbServerInfo.baseHashKey === newServerInfo.baseHashKey) {
      reloadGeojson = false
    }
  } catch (err) {}

  if (!reloadGeojson) {
    console.log('Data was not changed, no need to reload DB')
    if (!branchData.qe) branchData.qe = new QueryEngine(branchData.dbFileName)
    branchData.status = 'ready'
    return
  }

  console.log('Data or code has changed since last start: reload geojson')
  branchData.status = 'loading data'
  await QueryEngine.generateDb(__dirname + '/data/', branchData.dbFileName + '-tmp', newServerInfo)
  console.log('*** DB Loading finished ***')

  // Replace production DB
  // Stop running queries if any
  if (branchData.qe) await QueryEngine.deinit()
  // Clear query hash list
  branchData.hashToQuery = {}
  // Reset server base hash key
  branchData.BASE_HASH_KEY = newServerInfo.baseHashKey

  const dbAlreadyExists = fs.existsSync(branchData.dbFileName)
  if (dbAlreadyExists) {
    // supress previous DB
    fs.unlinkSync(branchData.dbFileName)
  }
  fs.renameSync(branchData.dbFileName + '-tmp', branchData.dbFileName)

  // Initialize the read-only engine
  branchData.qe = new QueryEngine(branchData.dbFileName)
  branchData.status = 'ready'
  console.log('Server base hash key: ' + branchData.BASE_HASH_KEY)
}

await reSyncData()

function reSyncPeriodic () {
  for (let b of DATA_GIT_BRANCHES) {
    const branchData = BRANCH_DATA[b]
    if (branchData.status !== 'ready') return
  }
  console.log('\n-- Periodic data check --')
  reSyncData()
}

// Poll git server every 60 minutes to check if data was modified
setInterval(reSyncPeriodic, 3600 * 1000);

// Insert this query in the global list of hash -> query for later lookup
// Returns a unique hash key referencing this query
const insertQuery = function (branch, q) {
  const branchData = BRANCH_DATA[branch]
  // Inject a key unique to each revision of the input data
  // this ensure the hash depends on query + data content
  q.baseHashKey = branchData.BASE_HASH_KEY
  const hash = hash_sum(q)
  branchData.hashToQuery[hash] = q
  return hash
}

// Returns the query matching this hash key
const lookupQuery = function (branch, hash) {
  const branchData = BRANCH_DATA[branch]
  if (!(hash in branchData.hashToQuery))
    return undefined
  return _.cloneDeep(branchData.hashToQuery[hash])
}

app.get('/api/v1/:branch/smtServerInfo', (req, res) => {
  const branchData = BRANCH_DATA[req.params.branch]
  if (!branchData) {
    res.status(404).send()
    return
  }
  res.send(branchData.qe.extraInfo)
})

app.get('/api/v1/:branch/smtConfig', (req, res) => {
  const branchData = BRANCH_DATA[req.params.branch]
  if (!branchData) {
    res.status(404).send()
    return
  }
  res.send(branchData.qe.smtConfig)
})

app.get('/api/v1/:branch/:serverHash/query', async (req, res) => {
  const branchData = BRANCH_DATA[req.params.branch]
  if (!branchData) {
    res.status(404).send()
    return
  }
  if (req.params.serverHash !== branchData.BASE_HASH_KEY) {
    res.status(404).send()
    return
  }
  const q = JSON.parse(decodeURIComponent(req.query.q))
  res.set('Cache-Control', 'public, max-age=31536000')
  const queryResp = await branchData.qe.queryAsync(q)
  res.send(queryResp)
})

app.get('/api/v1/:branch/:serverHash/queryVisual', (req, res) => {
  const branchData = BRANCH_DATA[req.params.branch]
  if (!branchData) {
    res.status(404).send()
    return
  }
  if (req.params.serverHash !== branchData.BASE_HASH_KEY) {
    res.status(404).send()
    return
  }
  const q = JSON.parse(decodeURIComponent(req.query.q))
  res.set('Cache-Control', 'public, max-age=31536000')
  res.send(insertQuery(req.params.branch, q))
})

app.get('/api/v1/:branch/hips/:queryHash/properties', (req, res) => {
  const branchData = BRANCH_DATA[req.params.branch]
  if (!branchData) {
    res.status(404).send()
    return
  }
  if (!lookupQuery(req.params.branch, req.params.queryHash)) {
    res.status(404).send()
    return
  }

  res.set('Cache-Control', 'public, max-age=31536000')
  res.type('text/plain')
  res.send(branchData.qe.getHipsProperties())
})

app.get('/api/v1/:branch/hips/:queryHash/:order(Norder\\d+)/:dir/:pix.geojson', async (req, res) => {
  const branchData = BRANCH_DATA[req.params.branch]
  if (!branchData) {
    res.status(404).send()
    return
  }
  res.set('Cache-Control', 'public, max-age=31536000')
  const order = parseInt(req.params.order.replace('Norder', ''))
  const pix = parseInt(req.params.pix.replace('Npix', ''))
  const q = lookupQuery(req.params.branch, req.params.queryHash)
  if (!q) {
    res.status(404).send()
    return
  }
  const tileResp = await branchData.qe.getHipsTileAsync(q, order, pix)
  if (!tileResp) {
    res.status(404).send()
    return
  }
  res.send(tileResp)
})

app.get('/api/v1/:branch/hips/:queryHash/Allsky.geojson', async (req, res) => {
  const branchData = BRANCH_DATA[req.params.branch]
  if (!branchData) {
    res.status(404).send()
    return
  }
  res.set('Cache-Control', 'public, max-age=31536000')
  const q = lookupQuery(req.params.branch, req.params.queryHash)
  if (!q) {
    res.status(404).send()
    return
  }
  const tileResp = await branchData.qe.getHipsTileAsync(q, -1, 0)
  if (!tileResp) {
    res.status(404).send()
    return
  }
  res.send(tileResp)
})

