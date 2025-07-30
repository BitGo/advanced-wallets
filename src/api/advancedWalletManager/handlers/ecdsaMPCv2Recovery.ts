import { BitGoRequest } from '../../../types/request';
import { AdvancedWalletManagerConfig } from '../../../shared/types';
import { AdvancedWalletManagerApiSpecRouteRequest } from '../../../advancedWalletManager/routers/advancedWalletManagerApiSpec';
import { retrieveKmsPrvKey } from '../utils';
import { DklsUtils } from '@bitgo-beta/sdk-lib-mpc';
import { CoinFamily } from '@bitgo-beta/statics';
import { InternalServerError } from '../../../shared/errors';

export async function ecdsaMPCv2Recovery(
  req: BitGoRequest<AdvancedWalletManagerConfig> & {
    body: AdvancedWalletManagerApiSpecRouteRequest<'v1.mpcv2.recovery', 'post'>;
  },
): Promise<any> {
  const { config, bitgo, body, params } = req;
  const { txHex, pub } = body;
  const coin = bitgo.coin(params.coin);
  if (coin.getFamily() !== CoinFamily.ETH) {
    throw new InternalServerError(
      `AWM does not support Mpc V2 recovery for coin family: ${coin.getFamily()}`,
    );
  }

  const userPrv = await retrieveKmsPrvKey({ pub, source: 'user', cfg: config });
  const backupPrv = await retrieveKmsPrvKey({ pub, source: 'backup', cfg: config });
  const messageHash = await (coin as any).getMessageHash(txHex);

  const signature = DklsUtils.constructEcdsaMpcv2RecoverySignature(
    userPrv,
    backupPrv,
    messageHash,
    pub,
  );

  return {
    txHex,
    stringifiedSignature: JSON.stringify(signature),
  };
}
