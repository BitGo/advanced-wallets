import 'should';
import sinon from 'sinon';
import { BitGoAPI } from '@bitgo-beta/sdk-api';
import { Hteth } from '@bitgo-beta/sdk-coin-eth';
import { AdvancedWalletManagerClient } from '../../../masterBitgoExpress/clients/advancedWalletManagerClient';
import { recoverEcdsaMPCv2Wallets } from '../../../masterBitgoExpress/handlers/recoveryEcdsa';
import { isEthLikeCoin } from '../../../shared/coinUtils';
import { makeMasterExpressTestConfig } from './testUtils';

describe('recoverEcdsaMPCv2Wallets', function () {
  const coin = 'hteth';
  const bitgo = new BitGoAPI({ env: 'test' });
  bitgo.register(coin, Hteth.createInstance);
  const baseCoin = bitgo.coin(coin);
  const awmClient = new AdvancedWalletManagerClient(
    makeMasterExpressTestConfig('http://advancedwalletmanager.invalid'),
    coin,
  );

  afterEach(function () {
    sinon.restore();
  });

  it('should reject eth-like recovery without userKey before querying the explorer or AWM', async function () {
    if (!isEthLikeCoin(baseCoin)) {
      throw new Error('hteth must be an eth-like coin');
    }
    const recoverSpy = sinon.spy(baseCoin, 'recover');
    const awmRecoverStub = sinon.stub(awmClient, 'recoverEcdsaMpcV2Wallet');

    await recoverEcdsaMPCv2Wallets(bitgo, baseCoin, awmClient, {
      commonKeychain: 'common-keychain',
      ethLikeParams: {
        backupKey: 'common-keychain',
        recoveryDestination: '0x1234567890123456789012345678901234567890',
        walletContractAddress: '0x0987654321098765432109876543210987654321',
        walletPassphrase: '',
        isTss: true,
      },
    }).should.be.rejectedWith(
      'userKey is required in eth like recovery params for Ecdsa MPCv2 recovery',
    );

    recoverSpy.called.should.be.false();
    awmRecoverStub.called.should.be.false();
  });
});
