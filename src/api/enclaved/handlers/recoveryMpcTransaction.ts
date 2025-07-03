import { randomBytes } from 'crypto';
import { EnclavedApiSpecRouteRequest } from '../../../enclavedBitgoExpress/routers/enclavedApiSpec';
import logger from '../../../logger';
import { isSolCoin } from '../../../shared/coinUtils';
import { parseJsonTransactions, retrieveKmsPrvKey } from '../utils';

export async function recoveryMpcTransaction(
  req: EnclavedApiSpecRouteRequest<'v1.mpc.recovery', 'post'>,
): Promise<any> {
  const { userPub, backupPub, bitgoPub, unsignedSweepPrebuildTx, walletContractAddress, coin } =
    req.decoded;

  //fetch prv and check that pub are valid
  const userPrv = await retrieveKmsPrvKey({ pub: userPub, source: 'user', cfg: req.config });
  const backupPrv = await retrieveKmsPrvKey({ pub: backupPub, source: 'backup', cfg: req.config });

  if (!userPrv || !backupPrv) {
    const errorMsg = `Error while recovery wallet, missing prv keys for user or backup on pub keys user=${userPub}, backup=${backupPub}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  const bitgo = req.bitgo;
  const baseCoin = bitgo.coin(coin);

  //I don't think that we need to check for specific on coins! I mean in the code there is no coinSol.signTx or anything specific
  // so I could delete this "isSolCoin" check later if you agree with me
  if (isSolCoin(baseCoin)) {
    try {
      // This wraps the payload with a couple of extras specified inside parseJsonTransactions, needs to dig more in deepth but maybe not necessary
      const txReq = await parseJsonTransactions(bitgo, unsignedSweepPrebuildTx);

      // From now on, we're starting to simulate the jump between OVC's

      // This is the keyshard data that's supposed to be pass to the function below, I'm not sure from where some of the fields comes from
      // but I need some of the data indicated in order to do the combineDecryptedShards call.

      // the private-mpc-key-1-of-1.json file that I got from the OVC on keygen
      //       {
      //     "xprv": "{\"iv\":\"2zECSR8CLyof+Wv8VRUULA==\",\"v\":1,\"iter\":10000,\"ks\":256,\"ts\":64,\"mode\":\"ccm\",\"adata\":\"\",\"cipher\":\"aes\",\"salt\":\"PVjD9jgzGWI=\",\"ct\":\"HkPffV/vJ5c6BRHQn3lP3wYgvMCWpNq8JtfOP3Z8o0xQns+jY0Hua1+5qwIrGab9vg+b/Fs5b1/88N6RWJyR6WVtGHX9qwZGg3tFnG4FNBozuFwpNLX2fixp4f/j2txDUil8ES5dr9YG73j/vDvQ7rRzORAT1tPMJO1GSRFFtrQ55avArG/oJQ==\"}",
      //     "walletGpgPubKeySigs": "-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nxk8EaGVlXBMFK4EEAAoCAwTo9Jbf4dFvq98U0YdFDQL0PFlj3n3jJkryoYz4\nFaWEXNTGTOV6ULCV6dADa82RhiVA3DTmsMA1LsmlKV2FxR6HzWZvdmMtMS11\nc2VyLWI0NDFiMGY3OWFiNDY2MzRhNjc0Y2I5ZSA8b3ZjLTEtdXNlci1iNDQx\nYjBmNzlhYjQ2NjM0YTY3NGNiOWVAYjQ0MWIwZjc5YWI0NjYzNGE2NzRjYjll\nLmNvbT7CjAQQEwgAPgWCaGVlXAQLCQcICZDqONQ0tb+usQMVCAoEFgACAQIZ\nAQKbAwIeARYhBPtxEnpaQD96GgIQjuo41DS1v66xAAB6jAD8DsH+R4cPUYnz\niTVfGs26/Puxjahp7zPBoH8iABKlD7YA/RSs51CEWuSFh6PMQWPgQ/0qorOp\niWtTt1ct0fqPawo/wsIJBBMTCAJ7BYJoZWWmAgsJCZCJNRsIDGune5cUgAAA\nAAAOAIBjb21tb25LZXljaGFpbjk2MDEwNzA5NjI0MjZjOTBmMjY0Mjg1NmMw\nZjdlZDMyMjg0ZjRhOGY5MDA4YjhiNTBkNGZjN2JjYmUzYzg3Mjg0ZDEwYzE0\nNzU2YzNmMGNjNWIwYzNjMWJkNzIwNjFmYzFlNmIxZTgzZGMzNWI4ZjA2MDNl\nZWM2OGQ5NGJmMWQwPRSAAAAAAAwAKHVzZXJHcGdLZXlJZGZiNzExMjdhNWE0\nMDNmN2ExYTAyMTA4ZWVhMzhkNDM0YjViZmFlYjE/FIAAAAAADgAoYmFja3Vw\nR3BnS2V5SWQzYzU2ZTEzZjI2NmE2MTUxNDcwODNlMTBiMjA3NmFlN2RjNDE1\nOTA0lRSAAAAAAAwAgHVzZXJTaGFyZVB1YjM3YTYxZGRlNWNkYTZiOThiYTU3\nZWMyYjdiNThkOWNhZjg2M2NjYjk4NTAwMzIxY2MzMjJiNWI4OTVkNTM4ODE0\nYzRiYTgxZWE2MmJiODEzNjI3MjZjNTgyYjBjM2ViZGFkN2E3YmM0MzUxNTU4\nNDI3YWE1NDk2MjJiNzMxMjgylxSAAAAAAA4AgGJhY2t1cFNoYXJlUHViZDMz\nYmUxOWQ2MzY5YmY4ODdlNGMzNmNkMTUwOTAyOTFjYjI4ODdmYmQ4MGJmMGUz\nZDEwMTEwNmRjMjhjODdiMDRjNGJhODFlYTYyYmI4MTM2MjcyNmM1ODJiMGMz\nZWJkYWQ3YTdiYzQzNTE1NTg0MjdhYTU0OTYyMmI3MzEyODICFQgCFgADmwIB\nAh4BFiEEdEvkP/ydEzeilCdeiTUbCAxrp3sAAK7XAQDUb4H5oFRtBw+okktP\npStZVkNzSq28iJ3eEFmTNZv+XwD/bOaHJgPx5RElpVtyqr3szlNOZxg8DLlV\n5uS6sYEDpWDOUwRoZWVcEgUrgQQACgIDBPCvq+iv+g3yRQP+QaZ2+0CZ9dwW\n80bGaRkOha3cvmp+aD4lC2NVacftwf11u3hS9mpPkXpKb2RDJKcTSjaR3fMD\nAQgHwngEGBMIACoFgmhlZVwJkOo41DS1v66xApsMFiEE+3ESelpAP3oaAhCO\n6jjUNLW/rrEAAKpcAP0Xmo92qGz+dXEZ7F5+YVHccZMK0/vIuscSECfTJ9ok\ndgEA5ApL0veeb+Q6A4VIEo+ijrueSHEFzgYhnuI6n3Kdq5nGTwRoZWWSEwUr\ngQQACgIDBMbe2LiE3I+0kvjAtnXnXXXgZQnmKhTo+IWRb6ZmfidQ3/r90IdN\n7VJQD0GvNED560Ah10PlvXAQDZYDND8ybx3Nam92Yy0yLWJhY2t1cC0yMDRl\nYTkyODQ1NGZhNmM4YmMwZTQ4MDMgPG92Yy0yLWJhY2t1cC0yMDRlYTkyODQ1\nNGZhNmM4YmMwZTQ4MDNAMjA0ZWE5Mjg0NTRmYTZjOGJjMGU0ODAzLmNvbT7C\njAQQEwgAPgWCaGVlkgQLCQcICZCyB2rn3EFZBAMVCAoEFgACAQIZAQKbAwIe\nARYhBDxW4T8mamFRRwg+ELIHaufcQVkEAABxvQD/QBKSxccYRnENLFnkSe+w\nPF2ckVBZgwpaPC58OpW8rJYBAK0z0zKJ3btLPZPOVeFSqlxtRkZJlfd0UfzQ\n8XLuN9AbwsIJBBMTCAJ7BYJoZWWmAgsJCZCJNRsIDGune5cUgAAAAAAOAIBj\nb21tb25LZXljaGFpbjk2MDEwNzA5NjI0MjZjOTBmMjY0Mjg1NmMwZjdlZDMy\nMjg0ZjRhOGY5MDA4YjhiNTBkNGZjN2JjYmUzYzg3Mjg0ZDEwYzE0NzU2YzNm\nMGNjNWIwYzNjMWJkNzIwNjFmYzFlNmIxZTgzZGMzNWI4ZjA2MDNlZWM2OGQ5\nNGJmMWQwPRSAAAAAAAwAKHVzZXJHcGdLZXlJZGZiNzExMjdhNWE0MDNmN2Ex\nYTAyMTA4ZWVhMzhkNDM0YjViZmFlYjE/FIAAAAAADgAoYmFja3VwR3BnS2V5\nSWQzYzU2ZTEzZjI2NmE2MTUxNDcwODNlMTBiMjA3NmFlN2RjNDE1OTA0lRSA\nAAAAAAwAgHVzZXJTaGFyZVB1YjM3YTYxZGRlNWNkYTZiOThiYTU3ZWMyYjdi\nNThkOWNhZjg2M2NjYjk4NTAwMzIxY2MzMjJiNWI4OTVkNTM4ODE0YzRiYTgx\nZWE2MmJiODEzNjI3MjZjNTgyYjBjM2ViZGFkN2E3YmM0MzUxNTU4NDI3YWE1\nNDk2MjJiNzMxMjgylxSAAAAAAA4AgGJhY2t1cFNoYXJlUHViZDMzYmUxOWQ2\nMzY5YmY4ODdlNGMzNmNkMTUwOTAyOTFjYjI4ODdmYmQ4MGJmMGUzZDEwMTEw\nNmRjMjhjODdiMDRjNGJhODFlYTYyYmI4MTM2MjcyNmM1ODJiMGMzZWJkYWQ3\nYTdiYzQzNTE1NTg0MjdhYTU0OTYyMmI3MzEyODICFQgCFgADmwIBAh4BFiEE\ndEvkP/ydEzeilCdeiTUbCAxrp3sAACPrAQCJin9mJAxEw9LgdUaBVnaYmAwB\nKMBleEAGOj3fh9PBeQD9HhQSg8Kezd+NC7RmT0OOubxo/pYoGqs/8qUDQ77o\n6J7OUwRoZWWSEgUrgQQACgIDBJV4nwE1qhwBylxtv+7QtQkLUfMuNQmSFBzv\nP3mreFUfAXZ8LeL/COhS2+THQ04yO+iDHqMliytL1SsfjgAt7zoDAQgHwngE\nGBMIACoFgmhlZZIJkLIHaufcQVkEApsMFiEEPFbhPyZqYVFHCD4Qsgdq59xB\nWQQAAEpVAP9C/7XFZq8M1Vr3mZ4pqo7WtZONu1k4gGrmF+6QIxVheQD/QEUF\nZUNOS+GpGLqGnYn1kr8gVq01/CYeIxVuRzAJYS4=\n=kXua\n-----END PGP PUBLIC KEY BLOCK-----\n",
      //     "bitgoShare": {
      //         "u": "f4a3561fa9f5c68b60b80164e136a30905aaa95c902ee2edf0f2c0938f985008",
      //         "y": "615b9147974c4e2b1eb1cb7eb96a923d231842eaa697743c75f714fd223edad1",
      //         "chaincode": "4c4ba81ea62bb81362726c582b0c3ebdad7a7bc4351558427aa549622b731282"
      //     },
      //     "backupShare": {
      //         "u": "f9897ba91b4f7ed394bc7b57e2dac2043550fb781c29f4515842b24066f6f70f",
      //         "y": "6d5ee6fac8480ffda1d3b76884c48f3c4658bebffda4bc76e0ff0d1f8311ecee",
      //         "chaincode": "14e1904ee976255c019c04b69f43c463007011d76335206c4a26d0b31a249f2e"
      //     },
      //     "coin": "sol",
      //     "ovcIndex": 1,
      //     "xGpgPrv": "{\"iv\":\"lOCfp6CrG+i60dkGNFpa4w==\",\"v\":1,\"iter\":10000,\"ks\":256,\"ts\":64,\"mode\":\"ccm\",\"adata\":\"\",\"cipher\":\"aes\",\"salt\":\"PVjD9jgzGWI=\",\"ct\":\"tt4vqYzhTvOzsKQj65XyoQgujU/k1sNvdt+cOquHO2ezTjf7RMEsvfJ8Tnh7q0ajJyZizg1rbKOMklkVcNn51A1DDn4iFacj+2rZV+irMUevxfjUmDW5pMGrkuNlsSJT5YTE7eeHb+2evkCvlG1KWdjeizprfxNswSaMajOcBlVeDwwXlgtnbiPGe61LybYg8Vrdmmycy7QNMSxBVu16/AWQXci7Z4O9jdH04z00EDzSj9VitJxk321I15YOfZ89gQdUuQWPhZVd6vEO6H/DCrSLOLqNIdIOuJ14lrCxahHNdY2jEDc1OmqIo9PLtsSvDRIgiix4N5iLmj6HzDF7nX1P1PusD7GshOfa3056w+0oeIA9JtWPl9rFqz7nflfeVIyVOttpfQXcsdGNi6/Q99g+G8dD0UFYHejA3ZJPcZy3pXsacvR6t/o5QHDmTcFtml7f+naUYN7kI2eq9M0TE8TzZs2Z6t+wUJYTCoHisl6ZDDsmQRDqZ3h1aSuP9QolWK7vjIR13iIHGeuv8hQOV1vI5bpo2I50SLTgTv+a8bLYSRX01aYh75hta2OrW31lL/Nr3qsAHxIpd3tjB5xDGzwibIUyTUjsyk8hTeCeab+cnCUKbNqGogtp8Y4RgXtl8p1R5LiFBKFwnkHgfYBli8aaf38yCGeVOVuTM/t3KSOFisW0xGweJrvqBrUJNPu+myiEW8s7MI7eJrp5SbuI1akUmSLk2JJZQQKnizsbQTNLCV0PhUFN75BLsSVFEemLhfgekLNvRznGJcj1PsWJPxETCRbJwDirb+9CkqQZ5NR0nW01hk4l6eiF8ko7/zwB6ELCF7s57TrWDcVLpj81ZdpjqZA7eSIrKhYDNteaTegQnNitSov/q75uY/rX02wz9cfLzq4asi3ldPj8gtaFubQOkyPI5su8pB3bXnCj3jke8iZ8uO5jykrLu5BoboyMBBmKN2zBGLqlXsr4UyHMG64d91HKhzChJXhJPsXGZf91sjG4yVeP7I5SRlM1fi/4gV3NmG2YHZa7e/SvNaqJXSsPHW3t0+5DXxDGK4Yk2onVIscvXKvmdwm8bNenuz8jeRRXPcgMAz3ndbuK8IJmiSmpreUxaRKLATPfZOv9MFA7pp56SvZsbxkl/D3zPZDJXYoubVUc91oq6b+5OmumYIRN7Lh0KUsxo882bJmcHF238a8IUrPuZkBaq/q+HaOZmde4\"}",
      //     "curveType": "tss-ed25519",
      //     "xpub": "9601070962426c90f2642856c0f7ed32284f4a8f9008b8b50d4fc7bcbe3c87284d10c14756c3f0cc5b0c3c1bd72061fc1e6b1e83dc35b8f0603eec68d94bf1d0",
      //     "fileName": "Private-mpc-key-1-of-1-1751475662757-f1d0.json",
      //     "isEncrypted": false,
      //     "gpgPrv": "-----BEGIN PGP PRIVATE KEY BLOCK-----\n\nxXQEaGVlXBMFK4EEAAoCAwTo9Jbf4dFvq98U0YdFDQL0PFlj3n3jJkryoYz4\nFaWEXNTGTOV6ULCV6dADa82RhiVA3DTmsMA1LsmlKV2FxR6HAAEAw7wp8vZN\nL42Ep05uaxs0U0ihdSrCCm7bHNMh/8YvNmQOyc1mb3ZjLTEtdXNlci1iNDQx\nYjBmNzlhYjQ2NjM0YTY3NGNiOWUgPG92Yy0xLXVzZXItYjQ0MWIwZjc5YWI0\nNjYzNGE2NzRjYjllQGI0NDFiMGY3OWFiNDY2MzRhNjc0Y2I5ZS5jb20+wowE\nEBMIAD4FgmhlZVwECwkHCAmQ6jjUNLW/rrEDFQgKBBYAAgECGQECmwMCHgEW\nIQT7cRJ6WkA/ehoCEI7qONQ0tb+usQAAeowA/A7B/keHD1GJ84k1XxrNuvz7\nsY2oae8zwaB/IgASpQ+2AP0UrOdQhFrkhYejzEFj4EP9KqKzqYlrU7dXLdH6\nj2sKP8d4BGhlZVwSBSuBBAAKAgME8K+r6K/6DfJFA/5Bpnb7QJn13BbzRsZp\nGQ6Frdy+an5oPiULY1Vpx+3B/XW7eFL2ak+RekpvZEMkpxNKNpHd8wMBCAcA\nAQC4dckBMwg4UBrkwjB07AEuWPVSc86J7NT0crKN1HlDvhBWwngEGBMIACoF\ngmhlZVwJkOo41DS1v66xApsMFiEE+3ESelpAP3oaAhCO6jjUNLW/rrEAAKpc\nAP0Xmo92qGz+dXEZ7F5+YVHccZMK0/vIuscSECfTJ9okdgEA5ApL0veeb+Q6\nA4VIEo+ijrueSHEFzgYhnuI6n3Kdq5k=\n=akyE\n-----END PGP PRIVATE KEY BLOCK-----\n",
      //     "privateKey": "eccabf4cc5000e19edea984e906d4ccf2e1eb6a74af17f597ff83423644d7b06ebe388d9c722135cf6fdcb0d0cd05edb708090e843eb40419b72d25393b44020"
      // }

      //USER OVC: step 1 of 6

      // This object represents data that i'm missing/not sure from where should I get it
      // Mind adding some refs/code paths or whatever you think is useful so I could understand/add the extra missing data?
      // I suppose some of this will come from the KMS service??

      const keyShardMissingPropsUser = {
        walletGpgPubKeySigns: '', // it's on private-mpc-key-1-of-1.json
        gpgPrv: '', // not on the .json file
        xGpgPrv: '', // it's on private-mpc-key-1-of-1.json as gpgKeyPair
        backupShare: '', // it's on private-mpc-key-1-of-1.json as backupShare
        bitgoShare: '', // it's on private-mpc-key-1-of-1.json as bitgoShare
      };

      const signingKeyUser = await bitgo.combineDecryptedShards({
        coin,
        xPub: userPub,
        xPriv: userPrv,
        curveType: 'tss-ed25519',
        isEncrypted: false,
        // Do we also need the fields below? on live debugging I saw those but maybe for our use case we don't?
        walletGpgKeySigns: keyShardMissingPropsUser.walletGpgPubKeySigns,
        gpgPrv: keyShardMissingPropsUser.gpgPrv,
        xGpgPrv: keyShardMissingPropsUser.xGpgPrv,
        backupShare: keyShardMissingPropsUser.backupShare,
        bitgoShare: keyShardMissingPropsUser.bitgoShare,
      });

      // Are these pure frontend packages? not comming from SDK in the OVC?
      // Should I copy full contents here?

      // import { MpcSigner, MPCStep } from '../../pkg/bitgo/mpc-signer'
      // import { MpcSignerFactory } from '../../pkg/bitgo/mpc-signer-factory'
      // import { MpcSigningOutput } from '../../pkg/bitgo/mpc-types'

      const mpcSignerUser = await MpcSignerFactory.createMpcSigner(txReq);
      mpcSignerUser.loadSigningKey(signingKeyUser);
      const signedTx1of6 = await mpcSignerUser.createShareForStep(3); // MPCStep.Step1Recovery

      // The file saved from OVC comes with this format, but maybe irrelevant to the topic at hand
      // {signatureShares: signedTxs} so it's gonna be {signatureShares: [signedTx]} in our case

      // Backup OVC STEP 2 of 6

      // I've the same issue than with the previous keyshard for user, check comment above I did the same here

      //    keyShard ={
      //     "xprv": "{\"iv\":\"k7iiuGe9QBoPwWT/CpSW+w==\",\"v\":1,\"iter\":10000,\"ks\":256,\"ts\":64,\"mode\":\"ccm\",\"adata\":\"\",\"cipher\":\"aes\",\"salt\":\"EslqUj6tP34=\",\"ct\":\"PvrlUHMO08vPdM28/lEz4101TD/NFL0bhFKm9Iq+kFUvpVbnccO//JbsGQ3pXjZpMDzmvoIdfwf2hp8VMcRJWd4S/gV29QCrdyE/bmMM61/OTb1XSuvRN74TRVabHtcnSGeXY3aRc8gWf+qC0XkB2QCP07t/sSnpgOm1cr+5bffmeQjNzYm7ZQ==\"}",
      //     "walletGpgPubKeySigs": "-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nxk8EaGVlXBMFK4EEAAoCAwTo9Jbf4dFvq98U0YdFDQL0PFlj3n3jJkryoYz4\nFaWEXNTGTOV6ULCV6dADa82RhiVA3DTmsMA1LsmlKV2FxR6HzWZvdmMtMS11\nc2VyLWI0NDFiMGY3OWFiNDY2MzRhNjc0Y2I5ZSA8b3ZjLTEtdXNlci1iNDQx\nYjBmNzlhYjQ2NjM0YTY3NGNiOWVAYjQ0MWIwZjc5YWI0NjYzNGE2NzRjYjll\nLmNvbT7CjAQQEwgAPgWCaGVlXAQLCQcICZDqONQ0tb+usQMVCAoEFgACAQIZ\nAQKbAwIeARYhBPtxEnpaQD96GgIQjuo41DS1v66xAAB6jAD8DsH+R4cPUYnz\niTVfGs26/Puxjahp7zPBoH8iABKlD7YA/RSs51CEWuSFh6PMQWPgQ/0qorOp\niWtTt1ct0fqPawo/wsIJBBMTCAJ7BYJoZWWmAgsJCZCJNRsIDGune5cUgAAA\nAAAOAIBjb21tb25LZXljaGFpbjk2MDEwNzA5NjI0MjZjOTBmMjY0Mjg1NmMw\nZjdlZDMyMjg0ZjRhOGY5MDA4YjhiNTBkNGZjN2JjYmUzYzg3Mjg0ZDEwYzE0\nNzU2YzNmMGNjNWIwYzNjMWJkNzIwNjFmYzFlNmIxZTgzZGMzNWI4ZjA2MDNl\nZWM2OGQ5NGJmMWQwPRSAAAAAAAwAKHVzZXJHcGdLZXlJZGZiNzExMjdhNWE0\nMDNmN2ExYTAyMTA4ZWVhMzhkNDM0YjViZmFlYjE/FIAAAAAADgAoYmFja3Vw\nR3BnS2V5SWQzYzU2ZTEzZjI2NmE2MTUxNDcwODNlMTBiMjA3NmFlN2RjNDE1\nOTA0lRSAAAAAAAwAgHVzZXJTaGFyZVB1YjM3YTYxZGRlNWNkYTZiOThiYTU3\nZWMyYjdiNThkOWNhZjg2M2NjYjk4NTAwMzIxY2MzMjJiNWI4OTVkNTM4ODE0\nYzRiYTgxZWE2MmJiODEzNjI3MjZjNTgyYjBjM2ViZGFkN2E3YmM0MzUxNTU4\nNDI3YWE1NDk2MjJiNzMxMjgylxSAAAAAAA4AgGJhY2t1cFNoYXJlUHViZDMz\nYmUxOWQ2MzY5YmY4ODdlNGMzNmNkMTUwOTAyOTFjYjI4ODdmYmQ4MGJmMGUz\nZDEwMTEwNmRjMjhjODdiMDRjNGJhODFlYTYyYmI4MTM2MjcyNmM1ODJiMGMz\nZWJkYWQ3YTdiYzQzNTE1NTg0MjdhYTU0OTYyMmI3MzEyODICFQgCFgADmwIB\nAh4BFiEEdEvkP/ydEzeilCdeiTUbCAxrp3sAAK7XAQDUb4H5oFRtBw+okktP\npStZVkNzSq28iJ3eEFmTNZv+XwD/bOaHJgPx5RElpVtyqr3szlNOZxg8DLlV\n5uS6sYEDpWDOUwRoZWVcEgUrgQQACgIDBPCvq+iv+g3yRQP+QaZ2+0CZ9dwW\n80bGaRkOha3cvmp+aD4lC2NVacftwf11u3hS9mpPkXpKb2RDJKcTSjaR3fMD\nAQgHwngEGBMIACoFgmhlZVwJkOo41DS1v66xApsMFiEE+3ESelpAP3oaAhCO\n6jjUNLW/rrEAAKpcAP0Xmo92qGz+dXEZ7F5+YVHccZMK0/vIuscSECfTJ9ok\ndgEA5ApL0veeb+Q6A4VIEo+ijrueSHEFzgYhnuI6n3Kdq5nGTwRoZWWSEwUr\ngQQACgIDBMbe2LiE3I+0kvjAtnXnXXXgZQnmKhTo+IWRb6ZmfidQ3/r90IdN\n7VJQD0GvNED560Ah10PlvXAQDZYDND8ybx3Nam92Yy0yLWJhY2t1cC0yMDRl\nYTkyODQ1NGZhNmM4YmMwZTQ4MDMgPG92Yy0yLWJhY2t1cC0yMDRlYTkyODQ1\nNGZhNmM4YmMwZTQ4MDNAMjA0ZWE5Mjg0NTRmYTZjOGJjMGU0ODAzLmNvbT7C\njAQQEwgAPgWCaGVlkgQLCQcICZCyB2rn3EFZBAMVCAoEFgACAQIZAQKbAwIe\nARYhBDxW4T8mamFRRwg+ELIHaufcQVkEAABxvQD/QBKSxccYRnENLFnkSe+w\nPF2ckVBZgwpaPC58OpW8rJYBAK0z0zKJ3btLPZPOVeFSqlxtRkZJlfd0UfzQ\n8XLuN9AbwsIJBBMTCAJ7BYJoZWWmAgsJCZCJNRsIDGune5cUgAAAAAAOAIBj\nb21tb25LZXljaGFpbjk2MDEwNzA5NjI0MjZjOTBmMjY0Mjg1NmMwZjdlZDMy\nMjg0ZjRhOGY5MDA4YjhiNTBkNGZjN2JjYmUzYzg3Mjg0ZDEwYzE0NzU2YzNm\nMGNjNWIwYzNjMWJkNzIwNjFmYzFlNmIxZTgzZGMzNWI4ZjA2MDNlZWM2OGQ5\nNGJmMWQwPRSAAAAAAAwAKHVzZXJHcGdLZXlJZGZiNzExMjdhNWE0MDNmN2Ex\nYTAyMTA4ZWVhMzhkNDM0YjViZmFlYjE/FIAAAAAADgAoYmFja3VwR3BnS2V5\nSWQzYzU2ZTEzZjI2NmE2MTUxNDcwODNlMTBiMjA3NmFlN2RjNDE1OTA0lRSA\nAAAAAAwAgHVzZXJTaGFyZVB1YjM3YTYxZGRlNWNkYTZiOThiYTU3ZWMyYjdi\nNThkOWNhZjg2M2NjYjk4NTAwMzIxY2MzMjJiNWI4OTVkNTM4ODE0YzRiYTgx\nZWE2MmJiODEzNjI3MjZjNTgyYjBjM2ViZGFkN2E3YmM0MzUxNTU4NDI3YWE1\nNDk2MjJiNzMxMjgylxSAAAAAAA4AgGJhY2t1cFNoYXJlUHViZDMzYmUxOWQ2\nMzY5YmY4ODdlNGMzNmNkMTUwOTAyOTFjYjI4ODdmYmQ4MGJmMGUzZDEwMTEw\nNmRjMjhjODdiMDRjNGJhODFlYTYyYmI4MTM2MjcyNmM1ODJiMGMzZWJkYWQ3\nYTdiYzQzNTE1NTg0MjdhYTU0OTYyMmI3MzEyODICFQgCFgADmwIBAh4BFiEE\ndEvkP/ydEzeilCdeiTUbCAxrp3sAACPrAQCJin9mJAxEw9LgdUaBVnaYmAwB\nKMBleEAGOj3fh9PBeQD9HhQSg8Kezd+NC7RmT0OOubxo/pYoGqs/8qUDQ77o\n6J7OUwRoZWWSEgUrgQQACgIDBJV4nwE1qhwBylxtv+7QtQkLUfMuNQmSFBzv\nP3mreFUfAXZ8LeL/COhS2+THQ04yO+iDHqMliytL1SsfjgAt7zoDAQgHwngE\nGBMIACoFgmhlZZIJkLIHaufcQVkEApsMFiEEPFbhPyZqYVFHCD4Qsgdq59xB\nWQQAAEpVAP9C/7XFZq8M1Vr3mZ4pqo7WtZONu1k4gGrmF+6QIxVheQD/QEUF\nZUNOS+GpGLqGnYn1kr8gVq01/CYeIxVuRzAJYS4=\n=kXua\n-----END PGP PUBLIC KEY BLOCK-----\n",
      //     "bitgoShare": {
      //         "u": "6339274c99fb4bbf7d8442a41e0885501b69d41b25873bbb332a8bbcf6b36e0a",
      //         "y": "615b9147974c4e2b1eb1cb7eb96a923d231842eaa697743c75f714fd223edad1",
      //         "chaincode": "4c4ba81ea62bb81362726c582b0c3ebdad7a7bc4351558427aa549622b731282"
      //     },
      //     "userShare": {
      //         "u": "67bf573133854bdab17b642ad0ce50c7567cb1499e4739de86ec1fa4af3ea604",
      //         "y": "6bf14fe44d5f90a54ec8587bd345d931f65f0e30995db34f7640ace8d2f431de",
      //         "chaincode": "ebe388d9c722135cf6fdcb0d0cd05edb708090e843eb40419b72d25393b44020"
      //     },
      //     "coin": "sol",
      //     "ovcIndex": 2,
      //     "xGpgPrv": "{\"iv\":\"H1Oabca63y/oKGwXyPSgng==\",\"v\":1,\"iter\":10000,\"ks\":256,\"ts\":64,\"mode\":\"ccm\",\"adata\":\"\",\"cipher\":\"aes\",\"salt\":\"EslqUj6tP34=\",\"ct\":\"QFjYXrvuwwb5d0TrmrWnhSUePcZVyXtrYCN8yn5CbRlr3z4kxQiD7HxBGYRHLSVvP+9wcMGioZTSwbokmczUzjWOKowzalnudd+hsfFn+qJnbeEMxbcJ4RrgmwBMcE/GYls7Bq+Idf/z1eM8GP/BNu/ms7vRUYeEaLJIn/KpcPOVhBGT4rh7Qzy48ga5upwwOmGUqwK6Yu1tCCtpsf1oJG+E6vE1oAtlEQuEBMFXu6/o3eKVDFHHi07aGK6yoPl2ubqZ87t4wPOedPyeyuCjSckVFHoPNKWiSfRoxzME0hlVNuuqUrk4iiuS/B0BSufuDVJQnNuQkTXgXLhyyDrlf/E9SMMZr0jG5pFJ1EVpNyx8xhmSyG5XhuN8Hw7+L1bRoWlMo14SyiPRcwNSdc2HeyhirNagrb6dgnGPNukJaiwUsn+V19uytU+k8OtcgodanSB7LLDv0s+27CO0RY7KGgnrCEEN4oqKu37CepYP3Zo0Uomm/O36Cij2Y4tAbapsfkIMwGno3tM245x1JWHY24r26gGGyYg8Jlr2HlXo+ab0Gic/8V66tmyK8ZB4fP2/6ccDVcRcDgc9WnGNEnKEt/Xtq2rC8MEcNB4y+9v8uwADpMPWGpKn8OFLtuNcQv7KIY23+DprjRUXV5EsIVMAP2m1dPGivcgJhE+4xwQHIYQiPCXJRO49edhjy1jezCXEuypqjvWDU5GindpP+tmH3WUOvhqFE3fI2GS1/e+KOPIU/w8GgnnN+XFduHdguOsvBL/IvQ97Wh9jiVeMi9cRW+ad1tiF5VHXdnIJBWwZ5TiQqxvHiKUYxpIbKa341hjGpa5fZBpSfexQ7l29iTRaqR+DmBwCdC8RvJfhBMEQUVW4lTCNWtBBDIJNK8Eggzb6GmBPHqPiJnHPeWxiEGWx3SLNvnfaiULJ9go9FNW7+CeM7an/kaVRNQKVbzDVz3irGRqlDpT7bP9nvuizuL+AcjiqGsieGiF7tYNkkjb0gAW+8J6xm7duwI61qmzH241KZA5b4P5JA3k/dJGNplCwLvMq+UBivTOY4vRc2MTI3e182fGKJJ+QxhmFaC3k4UoGFFC2PUpKlQ3W/qKR7DrOFUpAo0xgv7Sofd2TiiwnJPAViv/xtC4byEYnAgS8wYHhNXYdSes+SNKvLIHKlBrnSPuj31+dxlm6SymIdiWJmw67CE8tZHOgj7z693Wk+31C5aOIbqJS/Q==\"}",
      //     "curveType": "tss-ed25519",
      //     "xpub": "9601070962426c90f2642856c0f7ed32284f4a8f9008b8b50d4fc7bcbe3c87284d10c14756c3f0cc5b0c3c1bd72061fc1e6b1e83dc35b8f0603eec68d94bf1d0",
      //     "fileName": "Private-mpc-key-1-of-1-1751475685966-f1d0.json",
      //     "isEncrypted": false,
      //     "gpgPrv": "-----BEGIN PGP PRIVATE KEY BLOCK-----\n\nxXQEaGVlkhMFK4EEAAoCAwTG3ti4hNyPtJL4wLZ151114GUJ5ioU6PiFkW+m\nZn4nUN/6/dCHTe1SUA9BrzRA+etAIddD5b1wEA2WAzQ/Mm8dAAEAp1aSitIO\n9WapQxhw9iJPaXAuCfthYEKkXJjid0GxNSUOe81qb3ZjLTItYmFja3VwLTIw\nNGVhOTI4NDU0ZmE2YzhiYzBlNDgwMyA8b3ZjLTItYmFja3VwLTIwNGVhOTI4\nNDU0ZmE2YzhiYzBlNDgwM0AyMDRlYTkyODQ1NGZhNmM4YmMwZTQ4MDMuY29t\nPsKMBBATCAA+BYJoZWWSBAsJBwgJkLIHaufcQVkEAxUICgQWAAIBAhkBApsD\nAh4BFiEEPFbhPyZqYVFHCD4Qsgdq59xBWQQAAHG9AP9AEpLFxxhGcQ0sWeRJ\n77A8XZyRUFmDClo8Lnw6lbyslgEArTPTMondu0s9k85V4VKqXG1GRkmV93RR\n/NDxcu430BvHeARoZWWSEgUrgQQACgIDBJV4nwE1qhwBylxtv+7QtQkLUfMu\nNQmSFBzvP3mreFUfAXZ8LeL/COhS2+THQ04yO+iDHqMliytL1SsfjgAt7zoD\nAQgHAAD/eA6ktg6BjTXpMdpmtIIENRpSnCUB+aInZRRdSNeseNYO2MJ4BBgT\nCAAqBYJoZWWSCZCyB2rn3EFZBAKbDBYhBDxW4T8mamFRRwg+ELIHaufcQVkE\nAABKVQD/Qv+1xWavDNVa95meKaqO1rWTjbtZOIBq5hfukCMVYXkA/0BFBWVD\nTkvhqRi6hp2J9ZK/IFatNfwmHiMVbkcwCWEu\n=ZlKk\n-----END PGP PRIVATE KEY BLOCK-----\n",
      //     "privateKey": "9b0c7f5b9ce038f5cac6b4d51b93f7e1ddf83063306866f6fbee871dc24bcf0914e1904ee976255c019c04b69f43c463007011d76335206c4a26d0b31a249f2e"
      // }

      // In backup OVC we're also creating a new signer as we did in user OVC, so I assume is the same here on ebe?

      const keyShardMissingPropsBackup = {
        walletGpgPubKeySigs: '', // it's on private-mpc-key-1-of-1.json
        gpgPrv: '', // not on the .json file
        xGpgPrv: '', // it's on private-mpc-key-1-of-1.json as gpgKeyPair
        userShare: '', // it's on private-mpc-key-1-of-1.json as backupShare
        bitgoShare: '', // it's on private-mpc-key-1-of-1.json as bitgoShare
      };

      const signingKeyBackup = await bitgo.combineDecryptedShards({
        xprv: backupPrv, // but actually it's not because it expects a file that comes as {iv: "fsdafsadfsadf", v:1, iter: 10000} and so far the priv key part is only iv
        walletGpgPubKeySigs: keyShardMissingPropsBackup.walletGpgPubKeySigs,
        bitgoShare: keyShardMissingPropsBackup.bitgoShare,
        userShare: keyShardMissingPropsBackup.userShare,
        coin,
        xGpgPrv: keyShardMissingPropsBackup.xGpgPrv,
        curveType: 'tss-ed25519',
        xpub: backupPub, // the common keychain
        isEncrypted: false,
        gpgPrv: keyShardMissingPropsBackup.gpgPrv,
        privateKey: backupPrv, // it's like repeated at the top as xprv but xprv is a full json object, still don't know how to work with that one, check the other comment please
      });

      const mpcSignerBackup = await MpcSignerFactory.createMpcSigner(txReq); //txReq or txReq.txRequest??
      mpcSignerBackup.loadSigningKey(signingKeyBackup);

      //mpcSignerUser = calls made on OVC 1, mpcSignerBackup = the ones on OVC 2 or backup
      const signedTx2of6 = mpcSignerBackup.createShareForStep(
        3,
        undefined,
        randomBytes(64),
        signedTx1of6,
      );
      const signedTx3of6 = mpcSignerUser.createShareForStep(
        4,
        signedTx2of6.txRequest,
        randomBytes(64),
        signedTx2of6,
      );
      const signedTx4of6 = mpcSignerBackup.createShareForStep(
        4,
        undefined,
        undefined,
        signedTx3of6,
      );
      const signedTx5of6 = mpcSignerUser.createShareForStep(
        5,
        signedTx4of6.txRequest,
        undefined,
        signedTx4of6,
      );
      const signedTxFinal = mpcSignerBackup.createShareForStep(
        5,
        signedTx5of6.txRequest,
        undefined,
        signedTx5of6,
      );

      return signedTxFinal;
      // FINAL QUESTIONS related to this code path:
      // 1. In this process we didn't even needed the wallet contract address or destination, is that different from musig?
      // 2. No txPrebuild? then no big deal on coin specifics?
      // 3. Totally different methods for signing compared to musig: 4-5 calls to createShareForStep vs 2 calls for signTx (for half and full)
      // 4. Where is the txHex that we should broadcast? it's not serializedTx (on step 6 of 6), could it be signableHex? (looking at the last step payload when you finish step 6 on OVC)
    } catch (error) {
      logger.error('error while recovering wallet transaction:', error);
      throw error;
    }
  } else {
    const errorMsg = 'Unsupported coin type for recovery: ' + req.decoded.coin;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }
}
