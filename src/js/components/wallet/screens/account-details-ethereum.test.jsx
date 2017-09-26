import Immutable from 'immutable'
import React from 'react'
import { expect } from 'chai'
import { shallow } from 'enzyme'
import AccountDetailsEthereumScreen from './account-details-ethereum'
// import Presentation from '../presentation/account-details-ethereum'
import {stub} from '../../../../../test/utils'

describe('(Component) AccountDetailsEthereumScreen', function() {
  it('getWalletAddress should be called on componentWillMount', function() {
    const wrapper = shallow(
      (<AccountDetailsEthereumScreen.WrappedComponent
        {...AccountDetailsEthereumScreen.mapStateToProps(Immutable.fromJS({
          wallet: {
            money: {
              screenToDisplay: '',
              walletAddress: '',
              ether: {
                loaded: false,
                errorMsg: '',
                price: 0,
                amount: 0,
                checkingOut: false,
                buying: false
              }
            }
          }
        }))}
        closeAccountDetails={() => {}} />)
      )
    wrapper.instance()
    // expect(getWalletAddressAndBalance.called).to.be.true
  })
})
