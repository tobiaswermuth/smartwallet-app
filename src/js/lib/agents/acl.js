import GraphAgent from 'lib/agents/graph.js'
import WebidAgent from 'lib/agents/webid'
import HTTPAgent from 'lib/agents/http'
import LDPAgent from 'lib/agents/ldp'
import {PRED} from 'lib/namespaces'
import {Writer} from '../rdf.js'
import Util from 'lib/util'
import rdf from 'rdflib'
import _ from 'lodash'

class AclAgent extends HTTPAgent {
  // TODO Check here if the user can modify the acl and throw error if not.
  constructor(uri) {
    super()
    this.tmp = []
    this.aclUri = `${this.uri}.acl`
    this.uri = uri
    this.gAgent = new GraphAgent()
    this.indexChanges = {
      toInsert: [],
      toDelete: []
    }

    this.predMap = {
      write: PRED.write.uri,
      read: PRED.read.uri,
      control: PRED.control.uri
    }

    // @TODO Think about scoping here.
    this.authCreationQuery = []
    this.zombiePolicies = []

    this.revPredMap = {}
    this.revPredMap[PRED.write.uri] = 'write'
    this.revPredMap[PRED.read.uri] = 'read'
    this.revPredMap[PRED.control.uri] = 'control'

    this.toAdd = []
    this.toRemove = []
  }

  // Checks if an object is contained in an array by comparing it's props.
  containsObj(arr, obj) {
    if (arr.length === 0) {
      return -1
    }

    for (let i = 0; i < arr.length; i++) {
      if (arr[i].subject.uri === obj.subject.uri &&
          arr[i].predicate.uri === obj.predicate.uri &&
          arr[i].object.uri === obj.object.uri
      ) return i
    }
    return -1
  }

  /**
   * @summary Hydrates the object. Decided to not put in constructor,
   *          so that there's no async behaviour there. Also tries to
   *          deduce the URI to the acl file corresponding to the file.
   * @return undefined, we want the side effect.
   */

  _fetchInfo() {
    const wia = new WebidAgent()
    return wia.getAclUri(this.uri).then((aclUri) => {
      this.aclUri = aclUri
    }).then(() => {
      let results = []
      return this.gAgent.fetchTriplesAtUri(this.aclUri).then(result => {
        const {triples} = result
        triples.forEach(t => {
          results.push(t)
        })
        return results
      })
    })
  }

  initialize() {
    return this._fetchInfo().then((trips) => {
      const writer = new Writer()

      trips.forEach(t => {
        writer.addTriple(t.subject, t.predicate, t.object)
      })

      // Read all / Write all, basically public permission.
      writer.find(undefined, PRED.agentClass, PRED.Agent).forEach(pol => {
        this.tmp.push({
          user: '*',
          source: pol.subject.uri,
          mode: []
        })
      })

      writer.find(undefined, PRED.agent, undefined).forEach(pol => {
        this.tmp.push({
          user: pol.object.uri,
          source: pol.subject.uri,
          mode: []
        })
      })

      this.tmp.forEach(entry => {
        writer.find(rdf.sym(entry.source), PRED.mode, undefined)
        .forEach(pol => {
          entry.mode.push(pol.object.mode || pol.object.uri)
        })
      })
    })
  }

  /**
   * @summary Gives the specified user the specified permissions.
   * @param {string} user - the webid of the user, in case it's a * [wildcard],
   *                        then everyone is granted the specified access.
   * @param {string} mode - permission to do what? [read, write, control]
   * @return undefined, we want the side effect
   */

  // @TODO Wipe then add does not work now.
  // @TODO Don't inject in case more than one user.
  allow(user, mode) {
    let policyName
    let newPolicy = true
    let tempFound = false
    this.toRemove = this.toRemove.filter(e => {
      const exists = e.user === user && e.object === this.predMap[mode]
      if (exists) {
        this.tmp.push({source: e.subject, user, mode: [e.predicate]})
        tempFound = true
      }
      return !exists
    })

    if (tempFound) {
      return
    }

    this.tmp.forEach(entry => {
      if (entry.user === user) {
        if (entry.mode.indexOf(this.predMap[mode]) !== -1) {
          throw new Error('Policy already present')
        }
        // We can inject only if this is the only user in the policy.
        if (this.getAuthAgents(entry.source).length === 1) {
          newPolicy = false
          policyName = entry.source
          entry.mode.push(this.predMap[mode])
        } else {
          this.splitAuth(entry.user, entry.source, entry.mode)
          this.allow(entry.user, mode)
          throw new Error('Splitting first')
        }
      }
    })

    if (newPolicy) {
      policyName = `${this.aclUri}#${Util.randomString(5)}`
      this.tmp.push({
        source: policyName,
        user,
        mode: [this.predMap[mode]]
      })
    }

    this.toAdd.push({
      user,
      subject: policyName,
      predicate: PRED.mode,
      object: this.predMap[mode],
      newPolicy
    })
  }

  /**
   * @summary Takes from the specified user the specified permissions.
   * @param {string} user - the webid of the user, in case it's a * [wildcard],
   *                        then everyone loses the specified access.
   * @param {string} mode - permission to do what? [read, write, control]
   * @return undefined, we want the side effect
   */

  // @TODO Snackbar instead of console warn.
  removeAllow(user, mode) {
    let policyName
    let zombie = false
    const predicate = this.predMap[mode]
    this.tmp = this.tmp.filter(entry => {
      const found = entry.user === user && entry.mode.indexOf(predicate) !== -1
      if (found) {
        if (this.getAuthAgents(entry.source).length === 1) {
          policyName = entry.source
          if (entry.mode.length === 1) {
            zombie = true
          }
          entry.mode = entry.mode.filter(el => el !== predicate)
        } else {
        }
      }

      return !found || entry.mode.length !== 0
      /*
      if (!found) {
        if (entry.mode.length === 0) {
          return false
        }
      }
      return true
      */
    })

    this.toRemove.push({
      user: user,
      subject: policyName,
      predicate: PRED.mode,
      object: predicate,
      zombie
    })
  }

  indexRemove(payload) {
    // If we said we want to add it, and now say we want to delete it,
    // the adding rule get's popped out.
    let i = this.containsObj(this.indexChanges.toInsert, payload)
    if (i !== -1) {
      this.indexChanges.toInsert.splice(i, 1)
      return
    }

    // Making sure we don't add it twice
    if (this.containsObj(this.indexChanges.toDelete, payload) === -1) {
      this.indexChanges.toDelete.push(payload)
    }
  }

  indexAdd(payload) {
    // If we said we want to delete it, and now say we want to add it,
    // the deletion rule get's popped out.
    let i = this.containsObj(this.indexChanges.toDelete, payload)
    if (i !== -1) {
      this.indexChanges.toDelete.splice(i, 1)
      return
    }

    // Making sure we don't add it twice
    if (this.containsObj(this.indexChanges.toInsert, payload) === -1) {
      this.indexChanges.toInsert.push(payload)
    }
  }

  /**
   * @summary Tells if a user is allowed to do a certain thing on a file.
   * @return {bool} - Allowed / Not allowed.
   */
  isAllowed(user, mode) {
    if (!this.predMap[mode]) {
      return false
    }
    return _.includes(this.allowedPermissions(user), mode)
  }

  /**
   * @summary Returns a list of people allowed to do something
   */
  allAllowedUsers(mode) {
    if (!this.predMap[mode]) {
      return []
    }

    let pred = this.predMap[mode]
    let users = []
    this.tmp.forEach(entry => {
      if (entry.mode.indexOf(pred) !== -1) {
        users.push(entry.user)
      }
    })
    return users
  }

  /**
   * @summary Returns a list of permissions a user.
   * @param {string} user - the user webid
   * @param {bool} strict - if true, we only return modes speciffically given
   *                        to this user. If false, we retrurn the wildcarded
   *                        modes as well.
   * @return {array} - permissions [read,write,control]
   */
  allowedPermissions(user, strict = false) {
    let wildcard = user === '*'
    let permissions = []

    this.tmp.forEach(entry => {
      if (entry.user === user) {
        entry.mode.forEach(p => {
          if (!_.includes(permissions, this.revPredMap[p])) {
            permissions.push(this.revPredMap[p])
          }
        })
      }
    })

    // We append the open permissions as well, since they apply to all users.
    // But only if strict is set to false.
    if (!wildcard && !strict) {
      let general = this.allowedPermissions('*')
      general.forEach(el => {
        if (!_.includes(permissions, el)) {
          permissions.push(el)
        }
      })
    }
    return permissions
  }

  /**
   * @sumarry Serializes the new acl file and puts it to the server.
   *          Must be called at the end.
   * @return {promise} - the server response.
   */

  // @TODO Snackbar.
  commit() {
    if (!this.toAdd.length && !this.toRemove.length) {
      return
    }
    // These are used for composing the final patch.
    let addQuery = []
    let removeQuery = []

    this.toAdd.forEach(e => {
      if (e.newPolicy) {
        this.authCreationQuery = this.authCreationQuery.concat(
          this._newAuthorization(e.subject, e.user, [e.object])
        )
      } else {
        addQuery.push(rdf.st(
          rdf.sym(e.subject),
          e.predicate,
          rdf.sym(e.object)
        ))
      }
    })

    this.toRemove.forEach(e => {
      if (e.zombie) {
        this.zombiePolicies.push(e.subject)
      } else {
        removeQuery.push(rdf.st(
          rdf.sym(e.subject),
          e.predicate,
          rdf.sym(e.object)
        ))
      }
    })

    addQuery = addQuery.concat(this.authCreationQuery)
    return this.patch(this._proxify(this.aclUri), removeQuery, addQuery, {
      'Content-Type': 'text/turtle'
    }).then(() => {
      if (this.zombiePolicies.length) {
        this._wipeZombies(this.zombiePolicies)
      }
      // @TODO Abstract into a function
      this.toAdd = []
      this.toRemove = []
      this.zombiePlicies = []
      this.authCreationQuery = []
    }).catch((e) => {
    })
  }

  /* @summary - A zombie policy is one that has no users or / and no
   *   permissions associated to it, therefore it can be wiped.
   *
   * P.S. I wish the function was as badass as it's name would suggest.
   */
  _wipeZombies(policies) {
    const ldpAgent = new LDPAgent()
    return Promise.all(policies.map(pol => {
      return ldpAgent.findTriples(
        this.aclUri,
        rdf.sym(pol),
        undefined,
        undefined
      ).then(triples => {
        return this.patch(this._proxify(this.aclUri), triples, [])
      })
    }))
  }

  // Given an authorization policy name, returns
  // all users mentioned.
  getAuthAgents(authName) {
    let users = this.tmp.filter(policy =>
      policy.source === authName
    )
    users = users.map(entry => entry.user)
    return users
  }

  splitAuth(agent, authName, modes) {
    // We can't split when there's only one user
    if (this.getAuthAgents(authName).length === 1) {
      return
    }

    this.tmp = this.tmp.filter(el => {
      return el.user !== agent && el.source !== authName
    })

    // @TODO
    const name = `${authName}${Util.randomString(3)}`
    this.authCreationQuery = this.authCreationQuery.concat(
      this._newAuthorization(name, agent, modes)
    )
    /*
    modes.forEach(perm => {
      this.toRemove.push({
        user: agent,
        subject: authName,
        predicat: PRED.agent,
        object: perm,
        zombie: false
      })
    })
    */

    modes.forEach(perm => {
      this.toAdd.push({
        user: agent,
        subject: name,
        predicate: PRED.mode,
        object: perm,
        newPolicy: false
      })
    })

    this.tmp.push({
      user: agent,
      source: name,
      mode: modes
    })
  }

  _newAuthorization(authName, user, modes) {
    const wild = user === '*'
    user = wild ? PRED.Agent : rdf.sym(user)
    const pred = wild ? PRED.agentClass : PRED.agent

    let boilerplate = []
    boilerplate.push(
      rdf.st(rdf.sym(authName), PRED.type, PRED.auth),
      rdf.st(rdf.sym(authName), PRED.access, rdf.sym(this.uri)),
      rdf.st(rdf.sym(authName), pred, user),
    )

    modes.forEach(mode => {
      boilerplate.push(rdf.st(rdf.sym(authName), PRED.mode, rdf.sym(mode)))
    })
    return boilerplate
  }

  commitIndex() {
    let updates = []
    let indexUri = Util.getIndexUri()
    if (this.indexChanges.toInsert.length > 0) {
      this.indexChanges.toInsert.forEach((el) => {
        updates.push(
          this.gAgent.writeTriples(indexUri, [el], false)
        )
      })
    }

    if (this.indexChanges.toDelete.length > 0) {
      let payload = {
        uri: indexUri,
        triples: []
      }

      this.indexChanges.toDelete.forEach((el) => {
        payload.triples.push(el)
      })
      updates.push(this.gAgent.deleteTriple(payload))
    }
    return Promise.all(updates)
  }
}

export default AclAgent
