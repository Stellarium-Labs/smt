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

import marked from 'marked'
import stableStringify from 'json-stable-stringify'
import _ from 'lodash'
import filtrex from 'filtrex'
import sprintfjs from 'sprintf-js'

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export default {
  smtServerInfo: undefined,
  status: 'unknown',
  statusChangedCb: undefined,

  getServerStatus: async function () {
    try {
      const resp = await fetch(process.env.VUE_APP_SMT_SERVER + '/api/v1/status', {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      })
      return (await resp.json()).status || 'error'
    } catch (err) {
      return 'error'
    }
  },

  updateStatus: async function () {
    this.setStatus(await this.getServerStatus())
  },

  setStatus: async function (s) {
    if (this.status === s) return

    if (s === 'ready') {
      // The status just went to ready, update server information
      let resp = await fetch(process.env.VUE_APP_SMT_SERVER + '/api/v1/smtServerInfo', {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      })
      this.smtServerInfo = await resp.json()

      resp = await fetch(process.env.VUE_APP_SMT_SERVER + '/api/v1/smtConfig', {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      })
      this.smtConfig = await resp.json()
      const filtrexOptions = {
        extraFunctions: { sprintf: (fmt, x) => sprintfjs.sprintf(fmt, x) }
      }
      for (const f of this.smtConfig.fields) {
        f.description_html = marked(f.description)
        if (f.formatFunc) {
          f.formatFuncCompiled = filtrex.compileExpression(f.formatFunc, filtrexOptions)
        }
      }
    }

    this.status = s
    if (this.statusChangedCb) this.statusChangedCb(s)
  },

  init: async function (statusChangedCb) {
    if (statusChangedCb) this.statusChangedCb = statusChangedCb
    while (true) {
      await this.setStatus(await this.getServerStatus())
      if (this.status === 'ready') break
      await sleep(3000)
    }
  },

  queryToString: function (q) {
    const q2 = _.cloneDeep(q)
    q2.constraints.sort((c1, c2) => {
      const a = c1.fieldId + c1.operation + c1.expression
      const b = c2.fieldId + c2.operation + c2.expression
      return (a > b) - (a < b)
    })
    return stableStringify(q2)
  },

  query: async function (q) {
    try {
      console.assert(this.smtServerInfo.baseHashKey)
      const body = encodeURIComponent(this.queryToString(q))
      const response = await fetch(process.env.VUE_APP_SMT_SERVER + '/api/v1/' + this.smtServerInfo.baseHashKey + '/query?q=' + body, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      })
      if (response.status !== 200) {
        throw response.status
      }
      return response.json()
    } catch (err) {
      this.init()
      throw err
    }
  },

  queryVisual: async function (q) {
    try {
      console.assert(this.smtServerInfo.baseHashKey)
      const body = encodeURIComponent(stableStringify(q))
      const response = await fetch(process.env.VUE_APP_SMT_SERVER + '/api/v1/' + this.smtServerInfo.baseHashKey + '/queryVisual?q=' + body, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      })
      if (response.status !== 200) {
        throw response.status
      }
      return response.text()
    } catch (err) {
      this.init()
      throw err
    }
  }
}
