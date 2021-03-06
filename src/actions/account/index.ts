import { AnyAction, Dispatch } from 'redux'
import { genericActions, navigationActions } from 'src/actions/'
import { BackendMiddleware } from 'src/backendMiddleware'
import { routeList } from 'src/routeList'
import { DecoratedClaims, CategorizedClaims } from 'src/reducers/account'
import { SignedCredential } from 'jolocom-lib/js/credentials/signedCredential/signedCredential'
import { getClaimMetadataByCredentialType, getCredentialUiCategory, getUiCredentialTypeByType } from '../../lib/util'
import { cancelReceiving } from '../sso'

export const setDid = (did: string) => {
  return {
    type: 'DID_SET',
    value: did
  }
}

export const setSelected = (claim : DecoratedClaims) => {
  return {
    type: 'SET_SELECTED',
    selected: claim
  }
}

export const resetSelected = () => {
  return {
    type: 'RESET_SELECTED'
  }
}

export const handleClaimInput = (fieldValue: string, fieldName: string) => {
  return {
    type: 'HANLDE_CLAIM_INPUT',
    fieldName,
    fieldValue
  }
}

export const checkIdentityExists = () => {
  return async (dispatch: Dispatch<AnyAction>, getState: Function, backendMiddleware: BackendMiddleware) => {
    const { storageLib } = backendMiddleware

    try {
      const personas = await storageLib.get.persona()
      if (!personas.length) {
        dispatch(genericActions.toggleLoadingScreen(false))
        return
      }

      dispatch(setDid(personas[0].did))
      dispatch(genericActions.toggleLoadingScreen(false))
      dispatch(setIdentityWallet())

      dispatch(navigationActions.navigatorReset({ routeName: routeList.Home }))
    } catch (err) {
      if (err.message.indexOf('no such table') === 0) {
        return
      }
      dispatch(genericActions.showErrorScreen(err))
    }
  }
}

export const setIdentityWallet = () => {
  return async (dispatch: Dispatch<AnyAction>, getState: Function, backendMiddleware: BackendMiddleware) => {
    const { ethereumLib, keyChainLib, storageLib, encryptionLib } = backendMiddleware

    try {
      const did = getState().account.did.get('did')
      const encryptionPass = await keyChainLib.getPassword()
      const personaData = await storageLib.get.persona({ did })
      const { encryptedWif } = personaData[0].controllingKey
      const decryptedWif = encryptionLib.decryptWithPass({
        cipher: encryptedWif,
        pass: encryptionPass
      })

      const { privateKey } = ethereumLib.wifToEthereumKey(decryptedWif)
      await backendMiddleware.setIdentityWallet(Buffer.from(privateKey, 'hex'))
    } catch (err) {
      dispatch(genericActions.showErrorScreen(err))
    }
  }
}

export const openClaimDetails = (claim: DecoratedClaims) => {
  return (dispatch: Dispatch<AnyAction>) => {
    dispatch(setSelected(claim))
    dispatch(
      navigationActions.navigate({
        routeName: routeList.ClaimDetails
      })
    )
  }
}

export const saveClaim = () => {
  return async (dispatch: Dispatch<AnyAction>, getState: Function, backendMiddleware: BackendMiddleware) => {
    try {
      const { identityWallet, storageLib } = backendMiddleware
      const did = getState().account.did.get('did')
      const claimsItem = getState().account.claims.toJS().selected

      const verifiableCredential = await identityWallet.create.signedCredential({
        metadata: getClaimMetadataByCredentialType(claimsItem.credentialType),
        claim: claimsItem.claimData,
        subject: did
      })

      if (claimsItem.id) {
        await storageLib.delete.verifiableCredential(claimsItem.id)
      }

      await storageLib.store.verifiableCredential(verifiableCredential)
      await setClaimsForDid()

      dispatch(
        navigationActions.navigatorReset({
          routeName: routeList.Home
        })
      )
    } catch (err) {
      dispatch(genericActions.showErrorScreen(err))
    }
  }
}

// TODO Currently only rendering  / adding one
export const saveExternalCredentials = () => {
  return async (dispatch: Dispatch<AnyAction>, getState: Function, backendMiddleware: BackendMiddleware) => {
    const { storageLib } = backendMiddleware
    const externalCredentials = getState().account.claims.toJS().pendingExternal
    const cred: SignedCredential = externalCredentials[0]

    if (cred.getId()) {
      await storageLib.delete.verifiableCredential(cred.getId())
    }

    try {
      await storageLib.store.verifiableCredential(externalCredentials[0])
      dispatch(cancelReceiving())
    } catch (err) {
      dispatch(genericActions.showErrorScreen(err))
    }
  }
}

export const toggleLoading = (val: boolean) => {
  return {
    type: 'SET_LOADING',
    loading: val
  }
}

export const setClaimsForDid = () => {
  return async (dispatch: Dispatch<AnyAction>, getState: Function, backendMiddleware: BackendMiddleware) => {
    const state = getState().account.claims.toJS()

    dispatch(toggleLoading(!state.loading))
    const storageLib = backendMiddleware.storageLib

    const verifiableCredentials: SignedCredential[] = await storageLib.get.verifiableCredential()
    const claims = prepareClaimsForState(verifiableCredentials) as CategorizedClaims

    dispatch({
      type: 'SET_CLAIMS_FOR_DID',
      claims
    })
  }
}

const prepareClaimsForState = (credentials: SignedCredential[]) => {
  const categorizedClaims = {}
  const decoratedCredentials = convertToDecoratedClaim(credentials)

  decoratedCredentials.forEach(decoratedCred => {
    const uiCategory = getCredentialUiCategory(decoratedCred.credentialType)

    try {
      categorizedClaims[uiCategory].push(decoratedCred)
    } catch (err) {
      categorizedClaims[uiCategory] = [decoratedCred]
    }
  })

  return categorizedClaims
}

// TODO Util, make subject mandatory
export const convertToDecoratedClaim = (vCreds: SignedCredential[]) : DecoratedClaims[] => {
  return vCreds.map(vCred => {
    const claimData = { ...vCred.getCredentialSection() }
    delete claimData.id

    return {
      credentialType: getUiCredentialTypeByType(vCred.getType()),
      claimData,
      id: vCred.getId(),
      issuer: vCred.getIssuer(),
      subject: vCred.getCredentialSection().id || 'Not found',
      expires: vCred.getExpiryDate() || undefined
    }
  })
}
