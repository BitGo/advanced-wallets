import nock from 'nock';
import 'should';
import * as sinon from 'sinon';
import * as express from 'express';
import * as request from 'supertest';
import { AppMode, AdvancedWalletManagerConfig, TlsMode, SigningMode } from '../../../shared/types';
import { app as enclavedApp } from '../../../advancedWalletManagerApp';
import { BitGoAPI } from '@bitgo-beta/sdk-api';
import * as middleware from '../../../shared/middleware';
import { BitGoRequest } from '../../../types/request';
import * as utils from '../../../advancedWalletManager/handlers/utils/utils';
import {
  buildStateBindingAdata,
  sealStateBlob,
  STATE_BINDING_DOMAIN,
  STATE_BINDING_MISMATCH_ERROR,
} from '../../../advancedWalletManager/handlers/utils/stateBinding';

const ENCRYPTED_DATA_KEY =
  '1,2,3,0,120,222,140,157,217,111,195,208,47,200,213,217,82,189,16,171,207,16,138,46,228,224,190,138,63,132,239,80,164,8,124,105,140,1,27,61,180,40,45,94,243,196,95,71,146,240,249,140,231,178,0,0,0,126,48,124,6,9,42,134,72,134,247,13,1,7,6,160,111,48,109,2,1,0,48,104,6,9,42,134,72,134,247,13,1,7,1,48,30,6,9,96,134,72,1,101,3,4,1,46,48,17,4,12,115,239,175,219,100,1,209,88,93,117,98,167,2,1,16,128,59,21,22,232,220,65,90,225,157,209,67,125,11,176,151,84,9,229,154,164,67,17,135,158,106,222,220,93,124,231,14,167,59,236,161,55,34,249,62,170,252,0,170,211,100,168,123,50,23,187,247,30,140,221,224,150,25,180,142,14';

const USER_GPG_PUB =
  '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nxk8EaIpAwBMFK4EEAAoCAwRRQgq/FOV/rats/YBQB+bg7L8Z/uIY9OE9uWEy\nl18NwQvnxPDRQSFhXT4gmgSbPhCpKKLz4uACggRPQ48w/iZFzVViMzBlY2Iw\nOWY0ZjEzZmYxNzIxYjBjZGUgPHVzZXItYjMwZWNiMDlmNGYxM2ZmMTcyMWIw\nY2RlQGIzMGVjYjA5ZjRmMTNmZjE3MjFiMGNkZS5jb20+wowEEBMIAD4FgmiK\nQMAECwkHCAmQ+GFfDyTprSUDFQgKBBYAAgECGQECmwMCHgEWIQSrLYVqNCwc\nOgNIraH4YV8PJOmtJQAAjz8BAL2A/ZSVyXqGnQL9e0wlQWMv5RAauVen/sSc\n7ksmTR5CAP9Ou1EUsVAxp82g4stNlmLLxCz+4qYz1Xhe6wckJ5IZF85TBGiK\nQMASBSuBBAAKAgMExA577OmWJP1MOCwofghOiX6RVWzZzkdjrt9cJcpzeDkI\n/8ScaOnQqbwoCmqhOYr0SvdsoRwS+Uw2KIPmy70DFAMBCAfCdwQYEwgAKgWC\naIpAwAmQ+GFfDyTprSUCmwwWIQSrLYVqNCwcOgNIraH4YV8PJOmtJQAAFDgB\nAI7jc6fOBSQPuzWjtswmQPC2K5pk71OoiCNDBW7dixWYAPikuVv70uWB0FA+\nvcg6kUCMCu3PG57kN1cKXrQZnQ8F\n=DJaC\n-----END PGP PUBLIC KEY BLOCK-----\n';

const USER_PUBLIC_SHARE =
  'b50eef93f764af40da7561d302bed1e14707fb73633f60e267b3d4b25fb9a94a56e56301b217ebdf27e6e8e1dcdfcb5de5e9c2fda6aba998b754c8baaba2ebe2';

/** The plaintext KMS data key the /decryptDataKey nock hands back. */
const MOCK_PLAINTEXT_KEY =
  '115,23,145,49,185,59,87,165,87,53,233,8,177,59,137,233,118,9,5,73,119,147,55,122,141,249,161,156,19,13,224,101';

describe('MPC Finalize', () => {
  let agent: request.SuperAgentTest;
  let app: express.Application;
  let cfg: AdvancedWalletManagerConfig;
  const keyProviderUrl = 'http://key-provider.test';
  let bitgo: BitGoAPI;

  /**
   * Seals a keygen state blob the way `eddsaInitialize` does, bound to the given
   * source and coin. The plaintext must be the finalize state fixture: the
   * request's bitgo instance is the app's own (the middleware stub does not
   * rebind its captured import), so the handler performs a real decrypt for the
   * user source. The backup source stubs `BitGoAPI.prototype.decrypt`, which
   * intercepts on any instance and serves the state itself.
   */
  async function sealedKeygenState(source: 'user' | 'backup', stateJson: string, coin = 'tnear') {
    return sealStateBlob(bitgo, {
      plaintextKey: MOCK_PLAINTEXT_KEY,
      plaintext: stateJson,
      adata: buildStateBindingAdata(STATE_BINDING_DOMAIN.EDDSA_KEYGEN_INIT, { source, coin }),
    });
  }

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
    // app config
    cfg = {
      appMode: AppMode.ADVANCED_WALLET_MANAGER,
      signingMode: SigningMode.LOCAL,
      port: 0, // Let OS assign a free port
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      keyProviderUrl: keyProviderUrl,
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
    };

    app = enclavedApp(cfg);
    agent = request.agent(app);
  });

  beforeEach(() => {
    bitgo = new BitGoAPI({ env: 'test' });
    sinon.stub(bitgo, 'decrypt').resolves(
      JSON.stringify({
        sourceGpgPub: USER_GPG_PUB,
        sourceGpgPrv:
          '-----BEGIN PGP PRIVATE KEY BLOCK-----\n\nxXQEaIpAwBMFK4EEAAoCAwRRQgq/FOV/rats/YBQB+bg7L8Z/uIY9OE9uWEy\nl18NwQvnxPDRQSFhXT4gmgSbPhCpKKLz4uACggRPQ48w/iZFAAD9HpBMPmFQ\nKOF3lO/vX9MT0NjNX8ZDyjLX4gs3EJ94xF0ROc1VYjMwZWNiMDlmNGYxM2Zm\nMTcyMWIwY2RlIDx1c2VyLWIzMGVjYjA5ZjRmMTNmZjE3MjFiMGNkZUBiMzBl\nY2IwOWY0ZjEzZmYxNzIxYjBjZGUuY29tPsKMBBATCAA+BYJoikDABAsJBwgJ\nkPhhXw8k6a0lAxUICgQWAAIBAhkBApsDAh4BFiEEqy2FajQsHDoDSK2h+GFf\nDyTprSUAAI8/AQC9gP2Ulcl6hp0C/XtMJUFjL+UQGrlXp/7EnO5LJk0eQgD/\nTrtRFLFQMafNoOLLTZZiy8Qs/uKmM9V4XusHJCeSGRfHeARoikDAEgUrgQQA\nCgIDBMQOe+zpliT9TDgsKH4ITol+kVVs2c5HY67fXCXKc3g5CP/EnGjp0Km8\nKApqoTmK9Er3bKEcEvlMNiiD5su9AxQDAQgHAAD9FLLcWPJa0qjiX6FhahZI\nvlOvrtS1/BX1EH4FgW3HlP0SnsJ3BBgTCAAqBYJoikDACZD4YV8PJOmtJQKb\nDBYhBKsthWo0LBw6A0itofhhXw8k6a0lAAAUOAEAjuNzp84FJA+7NaO2zCZA\n8LYrmmTvU6iII0MFbt2LFZgA+KS5W/vS5YHQUD69yDqRQIwK7c8bnuQ3Vwpe\ntBmdDwU=\n=a275\n-----END PGP PRIVATE KEY BLOCK-----\n',
        sourcePrivateShare: {
          i: 1,
          t: 2,
          n: 3,
          y: 'b50eef93f764af40da7561d302bed1e14707fb73633f60e267b3d4b25fb9a94a',
          seed: '7d0fa910c12ffd654122b11f563b2ac5d9b9988e375670e0439c31d0e8cbabb6',
          chaincode: '56e56301b217ebdf27e6e8e1dcdfcb5de5e9c2fda6aba998b754c8baaba2ebe2',
        },
        counterPartyKeyShare: {
          from: 'user',
          to: 'backup',
          publicShare: USER_PUBLIC_SHARE,
          privateShare:
            '3e3de1036d07e779451494097d1700ba9554ab384be1a83fd03bbe2ab670e50456e56301b217ebdf27e6e8e1dcdfcb5de5e9c2fda6aba998b754c8baaba2ebe2',
          privateShareProof:
            '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nxk8EaIpAwBMFK4EEAAoCAwRRQgq/FOV/rats/YBQB+bg7L8Z/uIY9OE9uWEy\nl18NwQvnxPDRQSFhXT4gmgSbPhCpKKLz4uACggRPQ48w/iZFzVViMzBlY2Iw\nOWY0ZjEzZmYxNzIxYjBjZGUgPHVzZXItYjMwZWNiMDlmNGYxM2ZmMTcyMWIw\nY2RlQGIzMGVjYjA5ZjRmMTNmZjE3MjFiMGNkZS5jb20+wowEEBMIAD4FgmiK\nQMAECwkHCAmQ+GFfDyTprSUDFQgKBBYAAgECGQECmwMCHgEWIQSrLYVqNCwc\nOgNIraH4YV8PJOmtJQAAjz8BAL2A/ZSVyXqGnQL9e0wlQWMv5RAauVen/sSc\n7ksmTR5CAP9Ou1EUsVAxp82g4stNlmLLxCz+4qYz1Xhe6wckJ5IZF85TBGiK\nQMASBSuBBAAKAgMExA577OmWJP1MOCwofghOiX6RVWzZzkdjrt9cJcpzeDkI\n/8ScaOnQqbwoCmqhOYr0SvdsoRwS+Uw2KIPmy70DFAMBCAfCdwQYEwgAKgWC\naIpAwAmQ+GFfDyTprSUCmwwWIQSrLYVqNCwcOgNIraH4YV8PJOmtJQAAFDgB\nAI7jc6fOBSQPuzWjtswmQPC2K5pk71OoiCNDBW7dixWYAPikuVv70uWB0FA+\nvcg6kUCMCu3PG57kN1cKXrQZnQ8FzjMEaIpAwBYJKwYBBAHaRw8BAQdA1Skn\nocK2X6QzVJIipUbXhwg52vaH6rlJxia1UR0aPnrCeAQYEwgAKgWCaIpAwAmQ\n+GFfDyTprSUCmyAWIQSrLYVqNCwcOgNIraH4YV8PJOmtJQAAfMsBAPJe5buE\n8bUCZR7AZMf4XSZ888GU4CVAvt2zOB8IQwxZAP4lZjF1pBsqP2NN1YLrpe38\njd/uuqBVgPFwyIJ4NUyTag==\n=wznf\n-----END PGP PUBLIC KEY BLOCK-----\n',
          vssProof: '03c8d98bece0c8aae81c59ca77cd3ea76a58bf7d963ca61e06c61b8b2465ff7d',
          gpgKey: USER_GPG_PUB,
        },
      }),
    );
    // Setup middleware stubs before creating app
    sinon.stub(middleware, 'prepareBitGo').callsFake(() => (req, res, next) => {
      (req as BitGoRequest<AdvancedWalletManagerConfig>).bitgo = bitgo;
      (req as BitGoRequest<AdvancedWalletManagerConfig>).config = cfg;
      next();
    });
  });

  afterEach(() => {
    sinon.restore();
    nock.cleanAll();
  });

  it('should successfully finalize MPC key generation for user source', async () => {
    // Mock data key response from key provider
    const mockDataKeyResponse = {
      plaintextKey:
        '115,23,145,49,185,59,87,165,87,53,233,8,177,59,137,233,118,9,5,73,119,147,55,122,141,249,161,156,19,13,224,101',
    };
    nock(keyProviderUrl).post('/decryptDataKey').reply(200, mockDataKeyResponse);
    nock(keyProviderUrl).post('/key').reply(200, {
      pub: '821273e7e8ad33fd73d4b924bc83322b5a57027b3db9005355153c57d0512a9e97398fa3ac5f3f0cc6d2fe82c8d8b12c85e8ff572b212aa41ba384201552c9e0',
      source: 'user',
      coin: 'tnear',
      type: 'tss',
    });

    const mockUserBitgoKeyChain = {
      id: '688a40c546bf78887fd5880e255b5963',
      source: 'bitgo',
      type: 'tss',
      commonKeychain:
        '821273e7e8ad33fd73d4b924bc83322b5a57027b3db9005355153c57d0512a9e97398fa3ac5f3f0cc6d2fe82c8d8b12c85e8ff572b212aa41ba384201552c9e0',
      verifiedVssProof: true,
      isBitGo: true,
      isTrust: false,
      hsmType: 'institutional',
      keyShares: [
        {
          from: 'user',
          to: 'bitgo',
          publicShare: USER_PUBLIC_SHARE,
          privateShare:
            '-----BEGIN PGP MESSAGE-----\\n\\nwX4DUQ8XhGVGcTISAgME7esXhNAua6Lnt20cXHNncRBbQo1YwQ57h6F9GU7i\\nCpPDSLz2ZhaPjVnO6QXZhKdUBzSg+K97P4sy7c93piaajDAq4yJgNpkh7VD2\\nCWJVERBSTCW/oZdrxrxoX6EoTqiD5fK5Tm8fETU3wyfsnzNHHMTSsQH/TBbT\\nS9Mul9CtNAuJFHmDHGsjxQS9DjeJHtshyIEV65FQ/KK0tkG6No4cMzcpsUtL\\nOGM7qmike/aXUH025PAu3VO5WfMFY9BHvZyp/MR3yjQXQSZD2pUSWyok61ry\\nakmCN5qsULe6oj1AhZt3AYHzDO4iJa9bnfcuYipDo7g0KBQYiz2St06SaVgm\\nlH85PyGF6G4Mn6tqCwv5cs22+y5oiJzVwK42fA9cMZJJHZnaFg==\\n=NeDG\\n-----END PGP MESSAGE-----\\n',
          privateShareProof:
            '-----BEGIN PGP PUBLIC KEY BLOCK-----\\n\\nxk8EaIpAwBMFK4EEAAoCAwRRQgq/FOV/rats/YBQB+bg7L8Z/uIY9OE9uWEy\\nl18NwQvnxPDRQSFhXT4gmgSbPhCpKKLz4uACggRPQ48w/iZFzVViMzBlY2Iw\\nOWY0ZjEzZmYxNzIxYjBjZGUgPHVzZXItYjMwZWNiMDlmNGYxM2ZmMTcyMWIw\\nY2RlQGIzMGVjYjA5ZjRmMTNmZjE3MjFiMGNkZS5jb20+wowEEBMIAD4FgmiK\\nQMAECwkHCAmQ+GFfDyTprSUDFQgKBBYAAgECGQECmwMCHgEWIQSrLYVqNCwc\\nOgNIraH4YV8PJOmtJQAAjz8BAL2A/ZSVyXqGnQL9e0wlQWMv5RAauVen/sSc\\n7ksmTR5CAP9Ou1EUsVAxp82g4stNlmLLxCz+4qYz1Xhe6wckJ5IZF85TBGiK\\nQMASBSuBBAAKAgMExA577OmWJP1MOCwofghOiX6RVWzZzkdjrt9cJcpzeDkI\\n/8ScaOnQqbwoCmqhOYr0SvdsoRwS+Uw2KIPmy70DFAMBCAfCdwQYEwgAKgWC\\naIpAwAmQ+GFfDyTprSUCmwwWIQSrLYVqNCwcOgNIraH4YV8PJOmtJQAAFDgB\\nAI7jc6fOBSQPuzWjtswmQPC2K5pk71OoiCNDBW7dixWYAPikuVv70uWB0FA+\\nvcg6kUCMCu3PG57kN1cKXrQZnQ8FzjMEaIpAwBYJKwYBBAHaRw8BAQdAWC5S\\nEbFFIBigM0hHyKSUhxGoywLFqDOqQlDaE9NKY1DCeAQYEwgAKgWCaIpAwAmQ\\n+GFfDyTprSUCmyAWIQSrLYVqNCwcOgNIraH4YV8PJOmtJQAAY/IBALlF1Wpl\\nizeZBQhknzlP+vfaW5l21MaAJcUhwLMBAEh8AP9pbZsfgSSZF7iBJyWqH1gV\\naKDS9Vz2z68pjrbq3JxgUA==\\n=N0KE\\n-----END PGP PUBLIC KEY BLOCK-----\\n',
          vssProof: '03c8d98bece0c8aae81c59ca77cd3ea76a58bf7d963ca61e06c61b8b2465ff7d',
          gpgKey:
            '-----BEGIN PGP PUBLIC KEY BLOCK-----\\n\\nxk8EaIpAwBMFK4EEAAoCAwRRQgq/FOV/rats/YBQB+bg7L8Z/uIY9OE9uWEy\\nl18NwQvnxPDRQSFhXT4gmgSbPhCpKKLz4uACggRPQ48w/iZFzVViMzBlY2Iw\\nOWY0ZjEzZmYxNzIxYjBjZGUgPHVzZXItYjMwZWNiMDlmNGYxM2ZmMTcyMWIw\\nY2RlQGIzMGVjYjA5ZjRmMTNmZjE3MjFiMGNkZS5jb20+wowEEBMIAD4FgmiK\\nQMAECwkHCAmQ+GFfDyTprSUDFQgKBBYAAgECGQECmwMCHgEWIQSrLYVqNCwc\\nOgNIraH4YV8PJOmtJQAAjz8BAL2A/ZSVyXqGnQL9e0wlQWMv5RAauVen/sSc\\n7ksmTR5CAP9Ou1EUsVAxp82g4stNlmLLxCz+4qYz1Xhe6wckJ5IZF85TBGiK\\nQMASBSuBBAAKAgMExA577OmWJP1MOCwofghOiX6RVWzZzkdjrt9cJcpzeDkI\\n/8ScaOnQqbwoCmqhOYr0SvdsoRwS+Uw2KIPmy70DFAMBCAfCdwQYEwgAKgWC\\naIpAwAmQ+GFfDyTprSUCmwwWIQSrLYVqNCwcOgNIraH4YV8PJOmtJQAAFDgB\\nAI7jc6fOBSQPuzWjtswmQPC2K5pk71OoiCNDBW7dixWYAPikuVv70uWB0FA+\\nvcg6kUCMCu3PG57kN1cKXrQZnQ8F\\n=DJaC\\n-----END PGP PUBLIC KEY BLOCK-----\\n',
        },
        {
          from: 'backup',
          to: 'bitgo',
          publicShare:
            '73e4be925f7eedaea4c108b88745ab6c908ddc8071482691a19adc4e3589c39c3df4eb85345f19e872026ff56b7b0a1d119d5477cb50d0cbee2bf33c3c868db9',
          privateShare:
            '-----BEGIN PGP MESSAGE-----\\n\\nwX4DUQ8XhGVGcTISAgMEelLv//yJIjoortyWIJj8KJUG6ltWWGQVsw++H15i\\noEZhyrZhNP6cbbCZ+8nEn1G5qF6SqZ3tb7Vm5GAh0ibzxDAWj4D3qZEsPYIj\\nU/clfpMhf1kP+zM8ZEJ//TzA0MPF0bUuWgFYnkjENJ88pDAHacDSsQF0MUyN\\nBze6maayEhPKvm1doOlya+c+8EXT1YlLdW4nD9j92iaDc9bz3bCz7TThVsH9\\nq9xV+QZ/O0MEAkzKbpKaTMbVV8YQc1XFMYU04McTkqstVHAqSONVjEbmu9ov\\nL4Lrpk14s4mC1iTd/V+kA8W527sANLCRtaUXkvHiMr8CTEA6eobySBjQjFee\\n9MIOQmWE/oleita4CUelU7Py2qJeG0nD3pqPmlRraS+WRK5T5g==\\n=eibP\\n-----END PGP MESSAGE-----\\n',
          privateShareProof:
            '-----BEGIN PGP PUBLIC KEY BLOCK-----\\n\\nxk8EaIpAwBMFK4EEAAoCAwS6KHj/od9lIxin+1KK7XlZ3Hzs5QKkVmc12ZW1\\nvCCTnAju/HZ0s1XV6CRhdrTw6d9MTxG58viqn2Nl7j5Buiq5zVUwODgwNWI1\\nZTU4NGI4YmRhMmYyNWJmOTEgPHVzZXItMDg4MDViNWU1ODRiOGJkYTJmMjVi\\nZjkxQDA4ODA1YjVlNTg0YjhiZGEyZjI1YmY5MS5jb20+wowEEBMIAD4FgmiK\\nQMAECwkHCAmQFvKwNF9M/BIDFQgKBBYAAgECGQECmwMCHgEWIQRyXP44VjLq\\nqZqNDT4W8rA0X0z8EgAA8w0BANXiDaOm560leVWjji1QZzigjRyJ/sMhsUBG\\ncXRNGpOdAQD0VWVgbXmPiqXOzk9Aqwo4iuxiMpoSjcOGjelJhtiI685TBGiK\\nQMASBSuBBAAKAgMEfASPaxeQfF8fbxj+IxA1IvBNUTVnfdavndamohiBY208\\nfiyFttYfh6aTww6QqlWzqPXY9kU3/+PkgIhDI/Za2AMBCAfCeAQYEwgAKgWC\\naIpAwAmQFvKwNF9M/BICmwwWIQRyXP44VjLqqZqNDT4W8rA0X0z8EgAAov8B\\nAM92AiJU5QupKoVPSmNyaHoVSUC1zaFqUub2huTY0lliAQCWhmA0x9ZDWlCs\\nB3oLcs3H7MksK2f2DcOkRnTpmEyMLs4zBGiKQMAWCSsGAQQB2kcPAQEHQOIp\\nOYP/MUTly/druIZpoYbWAWV+x6O/GKHxEI17iAD0wngEGBMIACoFgmiKQMAJ\\nkBbysDRfTPwSApsgFiEEclz+OFYy6qmajQ0+FvKwNF9M/BIAAMisAP9D0Twe\\nSoFPdp/lxJEWuorTnOuDR8p0pjdAJcSL8pb19gEAnR9JdMM+PyX6M0eIf7uK\\nfj35AH6qP/kGuXSvYxa1Dr4=\\n=OSCQ\\n-----END PGP PUBLIC KEY BLOCK-----\\n',
          vssProof: '1ae52e48306e1f40937be076f409fd788a2dac611c0e1bf9e1c1d344473c10ab',
          gpgKey:
            '-----BEGIN PGP PUBLIC KEY BLOCK-----\\n\\nxk8EaIpAwBMFK4EEAAoCAwS6KHj/od9lIxin+1KK7XlZ3Hzs5QKkVmc12ZW1\\nvCCTnAju/HZ0s1XV6CRhdrTw6d9MTxG58viqn2Nl7j5Buiq5zVUwODgwNWI1\\nZTU4NGI4YmRhMmYyNWJmOTEgPHVzZXItMDg4MDViNWU1ODRiOGJkYTJmMjVi\\nZjkxQDA4ODA1YjVlNTg0YjhiZGEyZjI1YmY5MS5jb20+wowEEBMIAD4FgmiK\\nQMAECwkHCAmQFvKwNF9M/BIDFQgKBBYAAgECGQECmwMCHgEWIQRyXP44VjLq\\nqZqNDT4W8rA0X0z8EgAA8w0BANXiDaOm560leVWjji1QZzigjRyJ/sMhsUBG\\ncXRNGpOdAQD0VWVgbXmPiqXOzk9Aqwo4iuxiMpoSjcOGjelJhtiI685TBGiK\\nQMASBSuBBAAKAgMEfASPaxeQfF8fbxj+IxA1IvBNUTVnfdavndamohiBY208\\nfiyFttYfh6aTww6QqlWzqPXY9kU3/+PkgIhDI/Za2AMBCAfCeAQYEwgAKgWC\\naIpAwAmQFvKwNF9M/BICmwwWIQRyXP44VjLqqZqNDT4W8rA0X0z8EgAAov8B\\nAM92AiJU5QupKoVPSmNyaHoVSUC1zaFqUub2huTY0lliAQCWhmA0x9ZDWlCs\\nB3oLcs3H7MksK2f2DcOkRnTpmEyMLg==\\n=4fY3\\n-----END PGP PUBLIC KEY BLOCK-----\\n',
        },
        {
          from: 'bitgo',
          to: 'user',
          publicShare:
            'fe0ebc26269181aba6d1b4242b27e2bf1d63bad039e3b9f24655b87dcdba3059025f411cc5e839452ce9a5ab807ddbb18e61e7e1b924b03f7622c8292d295045',
          privateShare:
            '-----BEGIN PGP MESSAGE-----\\n\\nwX4D4jHNt3TUV5gSAgMEYmXIdEjKTj/aL10KVtk+11+FK9+2odDHJkVOXxDY\\npQUBhpqDncQaNA/nw70Oy1vqSyighrWBQ+88FUWFlrth9jCDGLlpPSzshBPr\\nCAGjtKpZXuLnLY+4iJGORhxvhr1m5rjqicVXYXEIUIzkjzpB5YLSsQF0ldk5\\nFIYjor/w2B46xp9v4e/kdsr6i+4N0t4Py/drPugTX/KNUL6JuNgVNNKMBQYj\\nkgZjAH8MmHoke5khidqSoZv1vVgV8Hyyt1EkTaZUgw7hOMvnnfNkrTwjug8W\\nO4qrbi3FPcCMIm3Y4Nk3Yq0o9ULltqa0fRO2y7QK25TGozassTu7lOHHXqSl\\np6BiSt5jkfD3T6jTgNVy7BEn4xaud9LwnkkcovFFrHVeoMY0nw==\\n=nf9c\\n-----END PGP MESSAGE-----\\n',
          vssProof: 'd53019317f974b4178c7a817e2918b9b362bd30e8bf783c1abaf332636430b37',
          paillierPublicKey:
            '92ded99beade267f8893b6350aa6b8bb6610c35ec5b385e34d3851d5264716d54e02b28f6d39f85f2d1cf4726f1e2dd3767109976cfbaad8e9c7229667b51185c80c88945d78568651664ffe4e97ca7b474d94cf70b169e73f42704947d2a23869aebb25d90a3257c0bf40bed9250a624761f3ee34f30d88940aba2d53ffada43c5b39d136474b1f7acc98251312f29ad34aed49375bf9649039e34c98c57ffa99dc080d83410ba03388c2b8fec2dce697dd4b6f8b4b62d440c4dc2a82cf3e3e42f550b9d65a48353232bbaa00a976d7c241409f1433e3eb9a6fb2bf26ea9e207d48503bb363c1bbb666903a86c734aeb5624fc3b93cdb9cf9b0600d1bddfa82985c775806f01d6171f5ee93258f9eb8e169cdca2754be164750cf3a2b7da2b0f0264a24b0286e84a919bc10c926626407f581d767c0298f6c808b1e199a76435137b4fc109c5c0cf2c0fac7e0634e6a4200e97425524287e24711b1d326be49c5225af302dc5d5dbb86fe32da35f19b4dcad43c4327db1c0aa9e655307b859d',
        },
        {
          from: 'bitgo',
          to: 'backup',
          publicShare:
            'fe0ebc26269181aba6d1b4242b27e2bf1d63bad039e3b9f24655b87dcdba3059025f411cc5e839452ce9a5ab807ddbb18e61e7e1b924b03f7622c8292d295045',
          privateShare:
            '-----BEGIN PGP MESSAGE-----\\n\\nwX4DYOtpWmpLnkMSAgMEYAAvmLkDBdEL9gqeA3y9l4kHiyZdqiFivAqOAIEl\\nzfXPPRmeMda5HLCiS2Zj3ot3FcXiothq0uOIkIp5x45kHzARwmb5UEuPoCkj\\ntdL3PzJXoZ/CjH//gzfALcwiIYRhbZks/nH1xIpSgLf68X/4Ed3SsQHa8U49\\ncywOlw3bBPrwhUtWr5RpTS74VaoDWUk2tmqAxH1QZAmB+n53muJw/8FGEU1S\\n0SWiwtKXURiIOi8qHvy2Z0gI9I/FT7WNHKhO/fnvRBue41ME9swr9T5ExXxL\\nai68kLtDV/bOwdCsJp0IEqcCAsnfaSXKftdXtzR3pJ6vDsGL1HtM4ZVDYxGE\\nsmXvWjiYn5w/JpCPJwXCRN+QfpSucLyBF6NiG0idbDoqAqAGgQ==\\n=9abk\\n-----END PGP MESSAGE-----\\n',
          vssProof: 'd53019317f974b4178c7a817e2918b9b362bd30e8bf783c1abaf332636430b37',
          paillierPublicKey:
            '92ded99beade267f8893b6350aa6b8bb6610c35ec5b385e34d3851d5264716d54e02b28f6d39f85f2d1cf4726f1e2dd3767109976cfbaad8e9c7229667b51185c80c88945d78568651664ffe4e97ca7b474d94cf70b169e73f42704947d2a23869aebb25d90a3257c0bf40bed9250a624761f3ee34f30d88940aba2d53ffada43c5b39d136474b1f7acc98251312f29ad34aed49375bf9649039e34c98c57ffa99dc080d83410ba03388c2b8fec2dce697dd4b6f8b4b62d440c4dc2a82cf3e3e42f550b9d65a48353232bbaa00a976d7c241409f1433e3eb9a6fb2bf26ea9e207d48503bb363c1bbb666903a86c734aeb5624fc3b93cdb9cf9b0600d1bddfa82985c775806f01d6171f5ee93258f9eb8e169cdca2754be164750cf3a2b7da2b0f0264a24b0286e84a919bc10c926626407f581d767c0298f6c808b1e199a76435137b4fc109c5c0cf2c0fac7e0634e6a4200e97425524287e24711b1d326be49c5225af302dc5d5dbb86fe32da35f19b4dcad43c4327db1c0aa9e655307b859d',
        },
      ],
      walletHSMGPGPublicKeySigs:
        '-----BEGIN PGP PUBLIC KEY BLOCK-----\n' +
        '\n' +
        'xk8EaIpAwBMFK4EEAAoCAwRRQgq/FOV/rats/YBQB+bg7L8Z/uIY9OE9uWEy\n' +
        'l18NwQvnxPDRQSFhXT4gmgSbPhCpKKLz4uACggRPQ48w/iZFzVViMzBlY2Iw\n' +
        'OWY0ZjEzZmYxNzIxYjBjZGUgPHVzZXItYjMwZWNiMDlmNGYxM2ZmMTcyMWIw\n' +
        'Y2RlQGIzMGVjYjA5ZjRmMTNmZjE3MjFiMGNkZS5jb20+wowEEBMIAD4FgmiK\n' +
        'QMAECwkHCAmQ+GFfDyTprSUDFQgKBBYAAgECGQECmwMCHgEWIQSrLYVqNCwc\n' +
        'OgNIraH4YV8PJOmtJQAAjz8BAL2A/ZSVyXqGnQL9e0wlQWMv5RAauVen/sSc\n' +
        '7ksmTR5CAP9Ou1EUsVAxp82g4stNlmLLxCz+4qYz1Xhe6wckJ5IZF8LCCQQT\n' +
        'EwgCewWCaIpAxAILCQmQiTUbCAxrp3uXFIAAAAAADgCAY29tbW9uS2V5Y2hh\n' +
        'aW44MjEyNzNlN2U4YWQzM2ZkNzNkNGI5MjRiYzgzMzIyYjVhNTcwMjdiM2Ri\n' +
        'OTAwNTM1NTE1M2M1N2QwNTEyYTllOTczOThmYTNhYzVmM2YwY2M2ZDJmZTgy\n' +
        'YzhkOGIxMmM4NWU4ZmY1NzJiMjEyYWE0MWJhMzg0MjAxNTUyYzllMD0UgAAA\n' +
        'AAAMACh1c2VyR3BnS2V5SWRhYjJkODU2YTM0MmMxYzNhMDM0OGFkYTFmODYx\n' +
        'NWYwZjI0ZTlhZDI1PxSAAAAAAA4AKGJhY2t1cEdwZ0tleUlkNzI1Y2ZlMzg1\n' +
        'NjMyZWFhOTlhOGQwZDNlMTZmMmIwMzQ1ZjRjZmMxMpUUgAAAAAAMAIB1c2Vy\n' +
        'U2hhcmVQdWI4MzQ5YmY3OWUyYmZiNmNkYWZlNjM5NWM2Zjc5MjUxZWE0ZGJh\n' +
        'ODIxNzJkMGRjZGVlMDlhZGJlY2JkZWI2ZGE5MDI1ZjQxMWNjNWU4Mzk0NTJj\n' +
        'ZTlhNWFiODA3ZGRiYjE4ZTYxZTdlMWI5MjRiMDNmNzYyMmM4MjkyZDI5NTA0\n' +
        'NZcUgAAAAAAOAIBiYWNrdXBTaGFyZVB1YjFlOTEyOGY1MTkzYTczMGVkYzJj\n' +
        'MjUzZGRhMWUzOGVkMmRhODJhNTkzNGI1YWY3NzNkYWI5ZTY5YTNlNmU1ODgw\n' +
        'MjVmNDExY2M1ZTgzOTQ1MmNlOWE1YWI4MDdkZGJiMThlNjFlN2UxYjkyNGIw\n' +
        'M2Y3NjIyYzgyOTJkMjk1MDQ1AhUIAhYAA5sCAQIeARYhBHRL5D/8nRM3opQn\n' +
        'Xok1GwgMa6d7AAA2zAD/Y9iQ9OloO2ROkgyd2TT+kYmqCpBtSJ8nQtD7GpNP\n' +
        't6MA/2y6tAjcXAau2daY0tjw5zKN9UjwbvPlfBaFMkXF9JFyzlMEaIpAwBIF\n' +
        'K4EEAAoCAwTEDnvs6ZYk/Uw4LCh+CE6JfpFVbNnOR2Ou31wlynN4OQj/xJxo\n' +
        '6dCpvCgKaqE5ivRK92yhHBL5TDYog+bLvQMUAwEIB8J3BBgTCAAqBYJoikDA\n' +
        'CZD4YV8PJOmtJQKbDBYhBKsthWo0LBw6A0itofhhXw8k6a0lAAAUOAEAjuNz\n' +
        'p84FJA+7NaO2zCZA8LYrmmTvU6iII0MFbt2LFZgA+KS5W/vS5YHQUD69yDqR\n' +
        'QIwK7c8bnuQ3VwpetBmdDwXGTwRoikDAEwUrgQQACgIDBLooeP+h32UjGKf7\n' +
        'UorteVncfOzlAqRWZzXZlbW8IJOcCO78dnSzVdXoJGF2tPDp30xPEbny+Kqf\n' +
        'Y2XuPkG6KrnNVTA4ODA1YjVlNTg0YjhiZGEyZjI1YmY5MSA8dXNlci0wODgw\n' +
        'NWI1ZTU4NGI4YmRhMmYyNWJmOTFAMDg4MDViNWU1ODRiOGJkYTJmMjViZjkx\n' +
        'LmNvbT7CjAQQEwgAPgWCaIpAwAQLCQcICZAW8rA0X0z8EgMVCAoEFgACAQIZ\n' +
        'AQKbAwIeARYhBHJc/jhWMuqpmo0NPhbysDRfTPwSAADzDQEA1eINo6bnrSV5\n' +
        'VaOOLVBnOKCNHIn+wyGxQEZxdE0ak50BAPRVZWBteY+Kpc7OT0CrCjiK7GIy\n' +
        'mhKNw4aN6UmG2IjrwsIJBBMTCAJ7BYJoikDEAgsJCZCJNRsIDGune5cUgAAA\n' +
        'AAAOAIBjb21tb25LZXljaGFpbjgyMTI3M2U3ZThhZDMzZmQ3M2Q0YjkyNGJj\n' +
        'ODMzMjJiNWE1NzAyN2IzZGI5MDA1MzU1MTUzYzU3ZDA1MTJhOWU5NzM5OGZh\n' +
        'M2FjNWYzZjBjYzZkMmZlODJjOGQ4YjEyYzg1ZThmZjU3MmIyMTJhYTQxYmEz\n' +
        'ODQyMDE1NTJjOWUwPRSAAAAAAAwAKHVzZXJHcGdLZXlJZGFiMmQ4NTZhMzQy\n' +
        'YzFjM2EwMzQ4YWRhMWY4NjE1ZjBmMjRlOWFkMjU/FIAAAAAADgAoYmFja3Vw\n' +
        'R3BnS2V5SWQ3MjVjZmUzODU2MzJlYWE5OWE4ZDBkM2UxNmYyYjAzNDVmNGNm\n' +
        'YzEylRSAAAAAAAwAgHVzZXJTaGFyZVB1YjgzNDliZjc5ZTJiZmI2Y2RhZmU2\n' +
        'Mzk1YzZmNzkyNTFlYTRkYmE4MjE3MmQwZGNkZWUwOWFkYmVjYmRlYjZkYTkw\n' +
        'MjVmNDExY2M1ZTgzOTQ1MmNlOWE1YWI4MDdkZGJiMThlNjFlN2UxYjkyNGIw\n' +
        'M2Y3NjIyYzgyOTJkMjk1MDQ1lxSAAAAAAA4AgGJhY2t1cFNoYXJlUHViMWU5\n' +
        'MTI4ZjUxOTNhNzMwZWRjMmMyNTNkZGExZTM4ZWQyZGE4MmE1OTM0YjVhZjc3\n' +
        'M2RhYjllNjlhM2U2ZTU4ODAyNWY0MTFjYzVlODM5NDUyY2U5YTVhYjgwN2Rk\n' +
        'YmIxOGU2MWU3ZTFiOTI0YjAzZjc2MjJjODI5MmQyOTUwNDUCFQgCFgADmwIB\n' +
        'Ah4BFiEEdEvkP/ydEzeilCdeiTUbCAxrp3sAAA+jAQCrOlH+pENYtVgc1OI2\n' +
        'XzmtIqmVvWKj/Gft774Ebw77NAD/SXYi5rfRc9V/fULVKx3ZmWQltY7nN5tS\n' +
        'X/0ci49E1UbOUwRoikDAEgUrgQQACgIDBHwEj2sXkHxfH28Y/iMQNSLwTVE1\n' +
        'Z33Wr53WpqIYgWNtPH4shbbWH4emk8MOkKpVs6j12PZFN//j5ICIQyP2WtgD\n' +
        'AQgHwngEGBMIACoFgmiKQMAJkBbysDRfTPwSApsMFiEEclz+OFYy6qmajQ0+\n' +
        'FvKwNF9M/BIAAKL/AQDPdgIiVOULqSqFT0pjcmh6FUlAtc2halLm9obk2NJZ\n' +
        'YgEAloZgNMfWQ1pQrAd6C3LNx+zJLCtn9g3DpEZ06ZhMjC4=\n' +
        '=1Fag\n' +
        '-----END PGP PUBLIC KEY BLOCK-----\n',
    };

    sinon
      .stub(utils, 'gpgDecrypt')
      .resolves(
        'b6d1289794c112f9ec89caf59c6b7c43022f47cc824aaac7d9faacb73ef5ed0c025f411cc5e839452ce9a5ab807ddbb18e61e7e1b924b03f7622c8292d295045',
      );
    sinon.stub(utils, 'verifyWalletSignatures').resolves();
    sinon.stub(utils, 'eddsaKeyCombine').resolves({
      pShare: {
        i: 0,
        t: 0,
        n: 0,
        y: '821273e7e8ad33fd73d4b924bc83322b5a57027b3db9005355153c57d0512a9e97398fa3ac5f3f0cc6d2fe82c8d8b12c85e8ff572b212aa41ba',
        u: '',
        prefix: '',
        chaincode: '384201552c9e0',
      },
      jShares: {},
    });

    const result = await agent.post('/api/tnear/mpc/key/finalize').send({
      source: 'user',
      coin: 'tnear',
      encryptedDataKey: ENCRYPTED_DATA_KEY,
      encryptedData: await sealedKeygenState(
        'user',
        // the decrypt stub below is the single source of truth for the state
        await bitgo.decrypt({ input: '', password: '' }),
      ),
      counterPartyKeyShare: {
        from: 'backup',
        to: 'user',
        publicShare:
          '73e4be925f7eedaea4c108b88745ab6c908ddc8071482691a19adc4e3589c39c3df4eb85345f19e872026ff56b7b0a1d119d5477cb50d0cbee2bf33c3c868db9',
        privateShare:
          '-----BEGIN PGP MESSAGE-----\n\nwX4D4jHNt3TUV5gSAgMEaH3hH7qYQ8+gaC19SH5DO+dwQzg4HDrm8n2KNtkz\nmdG+CTPBpR04V0wTAiv+ajbjNOUcVpoFHpXVQeNUawsQ/DB4WtWIgs0UB3mM\n7Y+9BbPEYDMPHe3PbEmg3oeQIxUfj1I5AqSBW7Op3heaSKMbrEXSsQGfvWTY\nK4a7GqupPanySINEvYkUEKC+wz/iK1MefQTHdcG45d7p/PlAVrhmQQbZYKmG\nO4MMfuHagvdqdAR5+EqnRf6lih1ED+Mr7JKr/VANt3rtrXr6MmoF+SAy8e7I\nW+F4xTUoza/42hJ503ilJS+LbSWk3UTLBLa26ffYiohHF4dZQrAWW7wzpRbp\nCdcgi0WLez7Jq8gDBvlAbkocpS8ZYB3q/yUS9GIT/5Ea8sg+dw==\n=kmpU\n-----END PGP MESSAGE-----\n',
        privateShareProof:
          '-----BEGIN PGP PUBLIC KEY BLOCK-----\n' +
          '\n' +
          'xk8EaIpAwBMFK4EEAAoCAwS6KHj/od9lIxin+1KK7XlZ3Hzs5QKkVmc12ZW1\n' +
          'vCCTnAju/HZ0s1XV6CRhdrTw6d9MTxG58viqn2Nl7j5Buiq5zVUwODgwNWI1\n' +
          'ZTU4NGI4YmRhMmYyNWJmOTEgPHVzZXItMDg4MDViNWU1ODRiOGJkYTJmMjVi\n' +
          'ZjkxQDA4ODA1YjVlNTg0YjhiZGEyZjI1YmY5MS5jb20+wowEEBMIAD4FgmiK\n' +
          'QMAECwkHCAmQFvKwNF9M/BIDFQgKBBYAAgECGQECmwMCHgEWIQRyXP44VjLq\n' +
          'qZqNDT4W8rA0X0z8EgAA8w0BANXiDaOm560leVWjji1QZzigjRyJ/sMhsUBG\n' +
          'cXRNGpOdAQD0VWVgbXmPiqXOzk9Aqwo4iuxiMpoSjcOGjelJhtiI685TBGiK\n' +
          'QMASBSuBBAAKAgMEfASPaxeQfF8fbxj+IxA1IvBNUTVnfdavndamohiBY208\n' +
          'fiyFttYfh6aTww6QqlWzqPXY9kU3/+PkgIhDI/Za2AMBCAfCeAQYEwgAKgWC\n' +
          'AM92AiJU5QupKoVPSmNyaHoVSUC1zaFqUub2huTY0lliAQCWhmA0x9ZDWlCs\n' +
          'B3oLcs3H7MksK2f2DcOkRnTpmEyMLs4zBGiKQMAWCSsGAQQB2kcPAQEHQJz+\n' +
          'NwYGNBFZSUNzAtDD3h2eNNvvN8DHaPq0bpqF7SPlwngEGBMIACoFgmiKQMAJ\n' +
          'kBbysDRfTPwSApsgFiEEclz+OFYy6qmajQ0+FvKwNF9M/BIAAJI6AP4rhvhE\n' +
          'YcLKsVziRbBMbLzWSu/ARU9sXthVO8hp7rB3IgEA3XcpuSfdLbp0BpTVVGir\n' +
          'fJzKpEVLeJkvSU3FpZv0z8Q=\n' +
          '=htVp\n' +
          '-----END PGP PUBLIC KEY BLOCK-----\n',
        vssProof: '1ae52e48306e1f40937be076f409fd788a2dac611c0e1bf9e1c1d344473c10ab',
        gpgKey:
          '-----BEGIN PGP PUBLIC KEY BLOCK-----\n' +
          '\n' +
          'xk8EaIpAwBMFK4EEAAoCAwS6KHj/od9lIxin+1KK7XlZ3Hzs5QKkVmc12ZW1\n' +
          'vCCTnAju/HZ0s1XV6CRhdrTw6d9MTxG58viqn2Nl7j5Buiq5zVUwODgwNWI1\n' +
          'ZTU4NGI4YmRhMmYyNWJmOTEgPHVzZXItMDg4MDViNWU1ODRiOGJkYTJmMjVi\n' +
          'ZjkxQDA4ODA1YjVlNTg0YjhiZGEyZjI1YmY5MS5jb20+wowEEBMIAD4FgmiK\n' +
          'QMAECwkHCAmQFvKwNF9M/BIDFQgKBBYAAgECGQECmwMCHgEWIQRyXP44VjLq\n' +
          'qZqNDT4W8rA0X0z8EgAA8w0BANXiDaOm560leVWjji1QZzigjRyJ/sMhsUBG\n' +
          'cXRNGpOdAQD0VWVgbXmPiqXOzk9Aqwo4iuxiMpoSjcOGjelJhtiI685TBGiK\n' +
          'QMASBSuBBAAKAgMEfASPaxeQfF8fbxj+IxA1IvBNUTVnfdavndamohiBY208\n' +
          'fiyFttYfh6aTww6QqlWzqPXY9kU3/+PkgIhDI/Za2AMBCAfCeAQYEwgAKgWC\n' +
          'aIpAwAmQFvKwNF9M/BICmwwWIQRyXP44VjLqqZqNDT4W8rA0X0z8EgAAov8B\n' +
          'AM92AiJU5QupKoVPSmNyaHoVSUC1zaFqUub2huTY0lliAQCWhmA0x9ZDWlCs\n' +
          'B3oLcs3H7MksK2f2DcOkRnTpmEyMLg==\n' +
          '=4fY3\n' +
          '-----END PGP PUBLIC KEY BLOCK-----\n',
      },
      bitgoKeyChain: mockUserBitgoKeyChain,
      counterPartyGpgPub:
        '-----BEGIN PGP PUBLIC KEY BLOCK-----\n' +
        '\n' +
        'xk8EaIpAwBMFK4EEAAoCAwS6KHj/od9lIxin+1KK7XlZ3Hzs5QKkVmc12ZW1\n' +
        'vCCTnAju/HZ0s1XV6CRhdrTw6d9MTxG58viqn2Nl7j5Buiq5zVUwODgwNWI1\n' +
        'ZTU4NGI4YmRhMmYyNWJmOTEgPHVzZXItMDg4MDViNWU1ODRiOGJkYTJmMjVi\n' +
        'ZjkxQDA4ODA1YjVlNTg0YjhiZGEyZjI1YmY5MS5jb20+wowEEBMIAD4FgmiK\n' +
        'QMAECwkHCAmQFvKwNF9M/BIDFQgKBBYAAgECGQECmwMCHgEWIQRyXP44VjLq\n' +
        'qZqNDT4W8rA0X0z8EgAA8w0BANXiDaOm560leVWjji1QZzigjRyJ/sMhsUBG\n' +
        'cXRNGpOdAQD0VWVgbXmPiqXOzk9Aqwo4iuxiMpoSjcOGjelJhtiI685TBGiK\n' +
        'QMASBSuBBAAKAgMEfASPaxeQfF8fbxj+IxA1IvBNUTVnfdavndamohiBY208\n' +
        'fiyFttYfh6aTww6QqlWzqPXY9kU3/+PkgIhDI/Za2AMBCAfCeAQYEwgAKgWC\n' +
        'aIpAwAmQFvKwNF9M/BICmwwWIQRyXP44VjLqqZqNDT4W8rA0X0z8EgAAov8B\n' +
        'AM92AiJU5QupKoVPSmNyaHoVSUC1zaFqUub2huTY0lliAQCWhmA0x9ZDWlCs\n' +
        'B3oLcs3H7MksK2f2DcOkRnTpmEyMLg==\n' +
        '=4fY3\n' +
        '-----END PGP PUBLIC KEY BLOCK-----\n',
    });

    // Assert the response structure
    result.should.have.property('statusCode', 200);
    result.body.should.not.have.property('combinedKey');
    result.body.should.have.property('source', 'user');
    result.body.should.have.property(
      'commonKeychain',
      '821273e7e8ad33fd73d4b924bc83322b5a57027b3db9005355153c57d0512a9e97398fa3ac5f3f0cc6d2fe82c8d8b12c85e8ff572b212aa41ba384201552c9e0',
    );
    result.body.should.have.property('counterpartyKeyShare');
    result.body.counterpartyKeyShare.should.have.property('from', 'user');
    result.body.counterpartyKeyShare.should.have.property('to', 'backup');
  });

  it('should successfully finalize MPC key generation for backup source', async () => {
    /**
     * The finalize handler decrypts a blob (encryptedData) that was saved during Phase 1 (initialize).
     * That blob contains the party's own GPG keys and their private share (i=2 for backup).
     * We need decrypt() to return backup-party material so the handler uses i=2, not i=1,
     * and builds signing material with userYShare instead of backupYShare.
     */
    sinon.stub(BitGoAPI.prototype, 'decrypt').resolves(
      JSON.stringify({
        sourceGpgPub:
          '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nxk8EaIpAwBMFK4EEAAoCAwS6KHj/od9lIxin+1KK7XlZ3Hzs5QKkVmc12ZW1\nvCCTnAju/HZ0s1XV6CRhdrTw6d9MTxG58viqn2Nl7j5Buiq5zVUwODgwNWI1\nZTU4NGI4YmRhMmYyNWJmOTEgPHVzZXItMDg4MDViNWU1ODRiOGJkYTJmMjVi\nZjkxQDA4ODA1YjVlNTg0YjhiZGEyZjI1YmY5MS5jb20+wowEEBMIAD4FgmiK\nQMAECwkHCAmQFvKwNF9M/BIDFQgKBBYAAgECGQECmwMCHgEWIQRyXP44VjLq\nqZqNDT4W8rA0X0z8EgAA8w0BANXiDaOm560leVWjji1QZzigjRyJ/sMhsUBG\ncXRNGpOdAQD0VWVgbXmPiqXOzk9Aqwo4iuxiMpoSjcOGjelJhtiI685TBGiK\nQMASBSuBBAAKAgMEfASPaxeQfF8fbxj+IxA1IvBNUTVnfdavndamohiBY208\nfiyFttYfh6aTww6QqlWzqPXY9kU3/+PkgIhDI/Za2AMBCAfCeAQYEwgAKgWC\naIpAwAmQFvKwNF9M/BICmwwWIQRyXP44VjLqqZqNDT4W8rA0X0z8EgAAov8B\nAM92AiJU5QupKoVPSmNyaHoVSUC1zaFqUub2huTY0lliAQCWhmA0x9ZDWlCs\nB3oLcs3H7MksK2f2DcOkRnTpmEyMLg==\n=4fY3\n-----END PGP PUBLIC KEY BLOCK-----\n',
        sourceGpgPrv:
          '-----BEGIN PGP PRIVATE KEY BLOCK-----\n\nxXQEaIpAwBMFK4EEAAoCAwS6KHj/od9lIxin+1KK7XlZ3Hzs5QKkVmc12ZW1\nvCCTnAju/HZ0s1XV6CRhdrTw6d9MTxG58viqn2Nl7j5Buiq5AAD9GmW3NYNI\nP/pRBf7v8AaIJIZRjJfRPj6N4KaxBMb0sxEDpc1VMDg4MDViNWU1ODRiOGJk\nYTJmMjViZjkxIDx1c2VyLTA4ODA1YjVlNTg0YjhiZGEyZjI1YmY5MUAwODgw\nNWI1ZTU4NGI4YmRhMmYyNWJmOTEuY29tPsKMBBATCAA+BYJoikDABAsJBwgJ\nkBbysDRfTPwSAxUICgQWAAIBAhkBApsDAh4BFiEEclz+OFYy6qmajQ0+FvKw\nNF9M/BIAAPMNAQDU4g2jpuetJXlVo44tUGc4oI0cif7DIbFARnF0TRqTnQEA\n9FVlYG15j4qlzs5PQKsKOIrsYjKaEo3Dho3pSYbYiOvXeARoikDAEgUrgQQA\nCgIDBHwEj2sXkHxfH28Y/iMQNSLwTVE1Z33Wr53WpqIYgWNtPH4shbbWH4em\nk8MOkKpVs6j12PZFN//j5ICIQyP2WtgDAQgHAAD/TdWMgW2d+bFLCj4uI0V4\nyxqJkVB4OeqBKEjT7UMBTxMSwngEGBMIACoFgmiKQAAJkBbysDRfTPwSApsMFiEE\nclz+OFYy6qmajQ0+FvKwNF9M/BIAABOQAQCTa1D5fApCe4tFWdXqbPLwHYr7\nNFHJ5LV7eqM3/qJGtAEAulv+H1J7W0RiqlW0L0eTQlwPGGg8HXl3DYLxz/qp\nM0A=\n=Xyqq\n-----END PGP PRIVATE KEY BLOCK-----\n',
        sourcePrivateShare: {
          i: 2,
          t: 2,
          n: 3,
          y: '73e4be925f7eedaea4c108b88745ab6c908ddc8071482691a19adc4e3589c39c',
          seed: '3df4eb85345f19e872026ff56b7b0a1d119d5477cb50d0cbee2bf33c3c868db9',
          chaincode: '56e56301b217ebdf27e6e8e1dcdfcb5de5e9c2fda6aba998b754c8baaba2ebe2',
        },
        counterPartyKeyShare: {
          from: 'backup',
          to: 'user',
          publicShare:
            '73e4be925f7eedaea4c108b88745ab6c908ddc8071482691a19adc4e3589c39c3df4eb85345f19e872026ff56b7b0a1d119d5477cb50d0cbee2bf33c3c868db9',
          privateShare:
            '3e3de1036d07e779451494097d1700ba9554ab384be1a83fd03bbe2ab670e50456e56301b217ebdf27e6e8e1dcdfcb5de5e9c2fda6aba998b754c8baaba2ebe2',
          privateShareProof:
            '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nxk8EaIpAwBMFK4EEAAoCAwS6KHj/od9lIxin+1KK7XlZ3Hzs5QKkVmc12ZW1\nvCCTnAju/HZ0s1XV6CRhdrTw6d9MTxG58viqn2Nl7j5Buiq5zVUwODgwNWI1\nZTU4NGI4YmRhMmYyNWJmOTEgPHVzZXItMDg4MDViNWU1ODRiOGJkYTJmMjVi\nZjkxQDA4ODA1YjVlNTg0YjhiZGEyZjI1YmY5MS5jb20+wowEEBMIAD4FgmiK\nQMAECwkHCAmQFvKwNF9M/BIDFQgKBBYAAgECGQECmwMCHgEWIQRyXP44VjLq\nqZqNDT4W8rA0X0z8EgAA8w0BANXiDaOm560leVWjji1QZzigjRyJ/sMhsUBG\ncXRNGpOdAQD0VWVgbXmPiqXOzk9Aqwo4iuxiMpoSjcOGjelJhtiI685TBGiK\nQMASBSuBBAAKAgMEfASPaxeQfF8fbxj+IxA1IvBNUTVnfdavndamohiBY208\nfiyFttYfh6aTww6QqlWzqPXY9kU3/+PkgIhDI/Za2AMBCAfCeAQYEwgAKgWC\naIpAwAmQFvKwNF9M/BICmwwWIQRyXP44VjLqqZqNDT4W8rA0X0z8EgAAov8B\nAM92AiJU5QupKoVPSmNyaHoVSUC1zaFqUub2huTY0lliAQCWhmA0x9ZDWlCs\nB3oLcs3H7MksK2f2DcOkRnTpmEyMLg==\n=4fY3\n-----END PGP PUBLIC KEY BLOCK-----\n',
          vssProof: '1ae52e48306e1f40937be076f409fd788a2dac611c0e1bf9e1c1d344473c10ab',
          gpgKey:
            '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nxk8EaIpAwBMFK4EEAAoCAwS6KHj/od9lIxin+1KK7XlZ3Hzs5QKkVmc12ZW1\nvCCTnAju/HZ0s1XV6CRhdrTw6d9MTxG58viqn2Nl7j5Buiq5zVUwODgwNWI1\nZTU4NGI4YmRhMmYyNWJmOTEgPHVzZXItMDg4MDViNWU1ODRiOGJkYTJmMjVi\nZjkxQDA4ODA1YjVlNTg0YjhiZGEyZjI1YmY5MS5jb20+wowEEBMIAD4FgmiK\nQMAECwkHCAmQFvKwNF9M/BIDFQgKBBYAAgECGQECmwMCHgEWIQRyXP44VjLq\nqZqNDT4W8rA0X0z8EgAA8w0BANXiDaOm560leVWjji1QZzigjRyJ/sMhsUBG\ncXRNGpOdAQD0VWVgbXmPiqXOzk9Aqwo4iuxiMpoSjcOGjelJhtiI685TBGiK\nQMASBSuBBAAKAgMEfASPaxeQfF8fbxj+IxA1IvBNUTVnfdavndamohiBY208\nfiyFttYfh6aTww6QqlWzqPXY9kU3/+PkgIhDI/Za2AMBCAfCeAQYEwgAKgWC\naIpAwAmQFvKwNF9M/BICmwwWIQRyXP44VjLqqZqNDT4W8rA0X0z8EgAAov8B\nAM92AiJU5QupKoVPSmNyaHoVSUC1zaFqUub2huTY0lliAQCWhmA0x9ZDWlCs\nB3oLcs3H7MksK2f2DcOkRnTpmEyMLg==\n=4fY3\n-----END PGP PUBLIC KEY BLOCK-----\n',
        },
      }),
    );

    /** Key provider decrypts the AWS KMS-wrapped data key, which is then used to AES-decrypt encryptedData above */
    nock(keyProviderUrl).post('/decryptDataKey').reply(200, {
      plaintextKey:
        '115,23,145,49,185,59,87,165,87,53,233,8,177,59,137,233,118,9,5,73,119,147,55,122,141,249,161,156,19,13,224,101',
    });
    /** Key provider stores the combined signing material after a successful finalize */
    nock(keyProviderUrl).post('/key').reply(200, {
      pub: '821273e7e8ad33fd73d4b924bc83322b5a57027b3db9005355153c57d0512a9e97398fa3ac5f3f0cc6d2fe82c8d8b12c85e8ff572b212aa41ba384201552c9e0',
      source: 'backup',
      coin: 'tnear',
      type: 'tss',
    });

    /**
     * BitGo's keychain holds all 4 cross-party shares produced during DKG:
     *   user→bitgo, backup→bitgo (shares sent to bitgo)
     *   bitgo→user, bitgo→backup (shares bitgo sends back, encrypted to each party's GPG key)
     * The handler searches this list for the share addressed `to: source` to get bitgo's private share for backup.
     * commonKeychain here must match pShare.y + pShare.chaincode from eddsaKeyCombine below — the handler
     * throws if they don't match.
     */
    const mockBitgoKeyChain = {
      id: '688a40c546bf78887fd5880e255b5963',
      source: 'bitgo',
      type: 'tss',
      commonKeychain:
        '821273e7e8ad33fd73d4b924bc83322b5a57027b3db9005355153c57d0512a9e97398fa3ac5f3f0cc6d2fe82c8d8b12c85e8ff572b212aa41ba384201552c9e0',
      verifiedVssProof: true,
      isBitGo: true,
      isTrust: false,
      hsmType: 'institutional',
      keyShares: [
        {
          from: 'user',
          to: 'bitgo',
          publicShare: USER_PUBLIC_SHARE,
          privateShare: '-----BEGIN PGP MESSAGE-----\\n\\nencrypted\\n-----END PGP MESSAGE-----\\n',
          vssProof: '03c8d98bece0c8aae81c59ca77cd3ea76a58bf7d963ca61e06c61b8b2465ff7d',
          gpgKey:
            '-----BEGIN PGP PUBLIC KEY BLOCK-----\\n\\nxk8EaIpAwBMFK4EEAAoCAwRRQgq/FOV/rats/YBQB+bg7L8Z/uIY9OE9uWEy\\nl18NwQvnxPDRQSFhXT4gmgSbPhCpKKLz4uACggRPQ48w/iZFzVViMzBlY2Iw\\nOWY0ZjEzZmYxNzIxYjBjZGUgPHVzZXItYjMwZWNiMDlmNGYxM2ZmMTcyMWIw\\nY2RlQGIzMGVjYjA5ZjRmMTNmZjE3MjFiMGNkZS5jb20+wowEEBMIAD4FgmiK\\nQMAECwkHCAmQ+GFfDyTprSUDFQgKBBYAAgECGQECmwMCHgEWIQSrLYVqNCwc\\nOgNIraH4YV8PJOmtJQAAjz8BAL2A/ZSVyXqGnQL9e0wlQWMv5RAauVen/sSc\\n7ksmTR5CAP9Ou1EUsVAxp82g4stNlmLLxCz+4qYz1Xhe6wckJ5IZF85TBGiK\\nQMASBSuBBAAKAgMExA577OmWJP1MOCwofghOiX6RVWzZzkdjrt9cJcpzeDkI\\n/8ScaOnQqbwoCmqhOYr0SvdsoRwS+Uw2KIPmy70DFAMBCAfCdwQYEwgAKgWC\\naIpAwAmQ+GFfDyTprSUCmwwWIQSrLYVqNCwcOgNIraH4YV8PJOmtJQAAFDgB\\nAI7jc6fOBSQPuzWjtswmQPC2K5pk71OoiCNDBW7dixWYAPikuVv70uWB0FA+\\nvcg6kUCMCu3PG57kN1cKXrQZnQ8F\\n=DJaC\\n-----END PGP PUBLIC KEY BLOCK-----\\n',
        },
        {
          from: 'backup',
          to: 'bitgo',
          publicShare:
            '73e4be925f7eedaea4c108b88745ab6c908ddc8071482691a19adc4e3589c39c3df4eb85345f19e872026ff56b7b0a1d119d5477cb50d0cbee2bf33c3c868db9',
          privateShare: '-----BEGIN PGP MESSAGE-----\\n\\nencrypted\\n-----END PGP MESSAGE-----\\n',
          vssProof: '1ae52e48306e1f40937be076f409fd788a2dac611c0e1bf9e1c1d344473c10ab',
          gpgKey:
            '-----BEGIN PGP PUBLIC KEY BLOCK-----\\n\\nxk8EaIpAwBMFK4EEAAoCAwS6KHj/od9lIxin+1KK7XlZ3Hzs5QKkVmc12ZW1\\nvCCTnAju/HZ0s1XV6CRhdrTw6d9MTxG58viqn2Nl7j5Buiq5zVUwODgwNWI1\\nZTU4NGI4YmRhMmYyNWJmOTEgPHVzZXItMDg4MDViNWU1ODRiOGJkYTJmMjVi\\nZjkxQDA4ODA1YjVlNTg0YjhiZGEyZjI1YmY5MS5jb20+wowEEBMIAD4FgmiK\\nQMAECwkHCAmQFvKwNF9M/BIDFQgKBBYAAgECGQECmwMCHgEWIQRyXP44VjLq\\nqZqNDT4W8rA0X0z8EgAA8w0BANXiDaOm560leVWjji1QZzigjRyJ/sMhsUBG\\ncXRNGpOdAQD0VWVgbXmPiqXOzk9Aqwo4iuxiMpoSjcOGjelJhtiI685TBGiK\\nQMASBSuBBAAKAgMEfASPaxeQfF8fbxj+IxA1IvBNUTVnfdavndamohiBY208\\nfiyFttYfh6aTww6QqlWzqPXY9kU3/+PkgIhDI/Za2AMBCAfCeAQYEwgAKgWC\\naIpAwAmQFvKwNF9M/BICmwwWIQRyXP44VjLqqZqNDT4W8rA0X0z8EgAAov8B\\nAM92AiJU5QupKoVPSmNyaHoVSUC1zaFqUub2huTY0lliAQCWhmA0x9ZDWlCs\\nB3oLcs3H7MksK2f2DcOkRnTpmEyMLg==\\n=4fY3\\n-----END PGP PUBLIC KEY BLOCK-----\\n',
        },
        {
          from: 'bitgo',
          to: 'user',
          publicShare:
            'fe0ebc26269181aba6d1b4242b27e2bf1d63bad039e3b9f24655b87dcdba3059025f411cc5e839452ce9a5ab807ddbb18e61e7e1b924b03f7622c8292d295045',
          privateShare: '-----BEGIN PGP MESSAGE-----\\n\\nencrypted\\n-----END PGP MESSAGE-----\\n',
          vssProof: 'd53019317f974b4178c7a817e2918b9b362bd30e8bf783c1abaf332636430b37',
          paillierPublicKey: 'mock-paillier-key',
        },
        {
          from: 'bitgo',
          to: 'backup',
          publicShare:
            'fe0ebc26269181aba6d1b4242b27e2bf1d63bad039e3b9f24655b87dcdba3059025f411cc5e839452ce9a5ab807ddbb18e61e7e1b924b03f7622c8292d295045',
          privateShare: '-----BEGIN PGP MESSAGE-----\\n\\nencrypted\\n-----END PGP MESSAGE-----\\n',
          vssProof: 'd53019317f974b4178c7a817e2918b9b362bd30e8bf783c1abaf332636430b37',
          paillierPublicKey: 'mock-paillier-key',
        },
      ],
      walletHSMGPGPublicKeySigs: 'mock-sigs',
    };

    /**
     * gpgDecrypt unwraps each party's private share using the source's GPG private key.
     * The returned hex is the raw private share bytes — first 64 chars are `u` (the secret scalar),
     * last 64 are the chaincode. The actual value matters for the key combination math
     * but we stub eddsaKeyCombine below so the content here is irrelevant.
     */
    sinon
      .stub(utils, 'gpgDecrypt')
      .resolves(
        'b6d1289794c112f9ec89caf59c6b7c43022f47cc824aaac7d9faacb73ef5ed0c025f411cc5e839452ce9a5ab807ddbb18e61e7e1b924b03f7622c8292d295045',
      );
    /** verifyWalletSignatures checks that key shares were signed by the real BitGo HSM — not meaningful in unit tests */
    sinon.stub(utils, 'verifyWalletSignatures').resolves();
    /**
     * eddsaKeyCombine runs the actual threshold math to produce the combined key.
     * pShare.y + pShare.chaincode must equal bitgoKeyChain.commonKeychain —
     * that's the check the handler makes at line 107 of eddsaMPCWalletGenerationFinalize.ts.
     */
    sinon.stub(utils, 'eddsaKeyCombine').resolves({
      pShare: {
        i: 0,
        t: 0,
        n: 0,
        y: '821273e7e8ad33fd73d4b924bc83322b5a57027b3db9005355153c57d0512a9e97398fa3ac5f3f0cc6d2fe82c8d8b12c85e8ff572b212aa41ba',
        u: '',
        prefix: '',
        chaincode: '384201552c9e0',
      },
      jShares: {},
    });

    const result = await agent.post('/api/tnear/mpc/key/finalize').send({
      source: 'backup',
      coin: 'tnear',
      encryptedDataKey: ENCRYPTED_DATA_KEY,
      encryptedData: await sealedKeygenState(
        'backup',
        // the prototype decrypt stub below serves the backup fixture
        'backup finalize state placeholder',
      ),
      counterPartyKeyShare: {
        from: 'user',
        to: 'backup',
        publicShare: USER_PUBLIC_SHARE,
        privateShare:
          '-----BEGIN PGP MESSAGE-----\n\nwX4D4jHNt3TUV5gSAgMEaH3hH7qYQ8+gaC19SH5DO+dwQzg4HDrm8n2KNtkz\nmdG+CTPBpR04V0wTAiv+ajbjNOUcVpoFHpXVQeNUawsQ/DB4WtWIgs0UB3mM\n7Y+9BbPEYDMPHe3PbEmg3oeQIxUfj1I5AqSBW7Op3heaSKMbrEXSsQGfvWTY\nK4a7GqupPanySINEvYkUEKC+wz/iK1MefQTHdcG45d7p/PlAVrhmQQbZYKmG\nO4MMfuHagvdqdAR5+EqnRf6lih1ED+Mr7JKr/VANt3rtrXr6MmoF+SAy8e7I\nW+F4xTUoza/42hJ503ilJS+LbSWk3UTLBLa26ffYiohHF4dZQrAWW7wzpRbp\nCdcgi0WLez7Jq8gDBvlAbkocpS8ZYB3q/yUS9GIT/5Ea8sg+dw==\n=kmpU\n-----END PGP MESSAGE-----\n',
        privateShareProof: USER_GPG_PUB,
        vssProof: '03c8d98bece0c8aae81c59ca77cd3ea76a58bf7d963ca61e06c61b8b2465ff7d',
        gpgKey: USER_GPG_PUB,
      },
      bitgoKeyChain: mockBitgoKeyChain,
      counterPartyGpgPub: USER_GPG_PUB,
    });

    result.should.have.property('statusCode', 200);
    result.body.should.not.have.property('combinedKey');
    result.body.should.have.property('source', 'backup');
    result.body.should.have.property(
      'commonKeychain',
      '821273e7e8ad33fd73d4b924bc83322b5a57027b3db9005355153c57d0512a9e97398fa3ac5f3f0cc6d2fe82c8d8b12c85e8ff572b212aa41ba384201552c9e0',
    );
    result.body.should.have.property('counterpartyKeyShare');
    result.body.counterpartyKeyShare.should.have.property('from', 'backup');
    result.body.counterpartyKeyShare.should.have.property('to', 'user');
  });

  it('should reject a keygen state blob replayed for the other source', async () => {
    // Key provider unwraps the data key; the binding check then rejects the
    // user-sealed blob before any state is decrypted.
    nock(keyProviderUrl).post('/decryptDataKey').reply(200, { plaintextKey: MOCK_PLAINTEXT_KEY });

    const result = await agent.post('/api/tnear/mpc/key/finalize').send({
      source: 'backup',
      coin: 'tnear',
      encryptedDataKey: ENCRYPTED_DATA_KEY,
      encryptedData: await sealedKeygenState(
        'user',
        // rejected at the binding check before any decryption
        'unused placeholder state',
      ),
      counterPartyGpgPub: USER_GPG_PUB,
      bitgoKeyChain: {
        id: '688a40c546bf78887fd5880e255b5963',
        source: 'bitgo',
        type: 'tss',
        commonKeychain:
          '821273e7e8ad33fd73d4b924bc83322b5a57027b3db9005355153c57d0512a9e97398fa3ac5f3f0cc6d2fe82c8d8b12c85e8ff572b212aa41ba384201552c9e0',
        verifiedVssProof: true,
        keyShares: [],
      },
      counterPartyKeyShare: {
        from: 'user',
        to: 'backup',
        publicShare: USER_PUBLIC_SHARE,
        privateShare: '00',
        privateShareProof: USER_GPG_PUB,
        vssProof: '00',
        gpgKey: USER_GPG_PUB,
      },
    });

    result.should.have.property('statusCode', 400);
    result.body.should.have.property('details', STATE_BINDING_MISMATCH_ERROR);
  });

  it('should reject a keygen state blob replayed for another coin', async () => {
    // Key provider unwraps the data key; the binding check then rejects the
    // tnear-sealed blob before any state is decrypted.
    nock(keyProviderUrl).post('/decryptDataKey').reply(200, { plaintextKey: MOCK_PLAINTEXT_KEY });

    const result = await agent.post('/api/tsol/mpc/key/finalize').send({
      source: 'user',
      coin: 'tsol',
      encryptedDataKey: ENCRYPTED_DATA_KEY,
      encryptedData: await sealedKeygenState(
        'user',
        // rejected at the binding check before any decryption
        'unused placeholder state',
      ),
      counterPartyGpgPub: USER_GPG_PUB,
      bitgoKeyChain: {
        id: '688a40c546bf78887fd5880e255b5963',
        source: 'bitgo',
        type: 'tss',
        commonKeychain:
          '821273e7e8ad33fd73d4b924bc83322b5a57027b3db9005355153c57d0512a9e97398fa3ac5f3f0cc6d2fe82c8d8b12c85e8ff572b212aa41ba384201552c9e0',
        verifiedVssProof: true,
        keyShares: [],
      },
      counterPartyKeyShare: {
        from: 'backup',
        to: 'user',
        publicShare: USER_PUBLIC_SHARE,
        privateShare: '00',
        privateShareProof: USER_GPG_PUB,
        vssProof: '00',
        gpgKey: USER_GPG_PUB,
      },
    });

    result.should.have.property('statusCode', 400);
    result.body.should.have.property('details', STATE_BINDING_MISMATCH_ERROR);
  });
});
