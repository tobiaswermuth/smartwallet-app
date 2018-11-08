import { ssoActions } from 'src/actions'
import configureStore from 'redux-mock-store'
import thunk from 'redux-thunk'

describe('SSO action creators', () => {
  describe('cancelSSO', () => {
    it('should navigate to home screen and clear the Credential Request', () => {
      const mockStore = configureStore([thunk])({})

      const action = ssoActions.cancelSSO()

      action(mockStore.dispatch)
      expect(mockStore.getActions()).toMatchSnapshot()
    })
  })

  describe('cancelReceiving', () => {
    it('should navigate to home screen and reset selected account', () => {
      const mockStore = configureStore([thunk])({})

      const action = ssoActions.cancelReceiving()

      action(mockStore.dispatch)
      expect(mockStore.getActions()).toMatchSnapshot()
    })
  })
})
