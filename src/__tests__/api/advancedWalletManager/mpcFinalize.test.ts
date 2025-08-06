import nock from 'nock';
import 'should';
import * as sinon from 'sinon';
import * as express from 'express';
import * as request from 'supertest';
import { AppMode, AdvancedWalletManagerConfig, TlsMode } from '../../../shared/types';
import { app as enclavedApp } from '../../../advancedWalletManagerApp';
import { BitGoAPI } from '@bitgo-beta/sdk-api';
import * as middleware from '../../../shared/middleware';
import { BitGoRequest } from '../../../types/request';
import * as utils from '../../../api/advancedWalletManager/utils';

describe('MPC Finalize', () => {
  let agent: request.SuperAgentTest;
  let app: express.Application;
  let cfg: AdvancedWalletManagerConfig;
  const kmsUrl = 'http://kms.com';
  let bitgo: BitGoAPI;

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
    // app config
    cfg = {
      appMode: AppMode.ADVANCED_WALLET_MANAGER,
      port: 0, // Let OS assign a free port
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      kmsUrl: kmsUrl,
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
    };

    app = enclavedApp(cfg);
    agent = request.agent(app);
  });

  beforeEach(() => {
    bitgo = new BitGoAPI({ env: 'test' });
    sinon.stub(bitgo, 'decrypt').returns(
      JSON.stringify({
        sourceGpgPub:
          '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nxk8EaIpAwBMFK4EEAAoCAwRRQgq/FOV/rats/YBQB+bg7L8Z/uIY9OE9uWEy\nl18NwQvnxPDRQSFhXT4gmgSbPhCpKKLz4uACggRPQ48w/iZFzVViMzBlY2Iw\nOWY0ZjEzZmYxNzIxYjBjZGUgPHVzZXItYjMwZWNiMDlmNGYxM2ZmMTcyMWIw\nY2RlQGIzMGVjYjA5ZjRmMTNmZjE3MjFiMGNkZS5jb20+wowEEBMIAD4FgmiK\nQMAECwkHCAmQ+GFfDyTprSUDFQgKBBYAAgECGQECmwMCHgEWIQSrLYVqNCwc\nOgNIraH4YV8PJOmtJQAAjz8BAL2A/ZSVyXqGnQL9e0wlQWMv5RAauVen/sSc\n7ksmTR5CAP9Ou1EUsVAxp82g4stNlmLLxCz+4qYz1Xhe6wckJ5IZF85TBGiK\nQMASBSuBBAAKAgMExA577OmWJP1MOCwofghOiX6RVWzZzkdjrt9cJcpzeDkI\n/8ScaOnQqbwoCmqhOYr0SvdsoRwS+Uw2KIPmy70DFAMBCAfCdwQYEwgAKgWC\naIpAwAmQ+GFfDyTprSUCmwwWIQSrLYVqNCwcOgNIraH4YV8PJOmtJQAAFDgB\nAI7jc6fOBSQPuzWjtswmQPC2K5pk71OoiCNDBW7dixWYAPikuVv70uWB0FA+\nvcg6kUCMCu3PG57kN1cKXrQZnQ8F\n=DJaC\n-----END PGP PUBLIC KEY BLOCK-----\n',
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
          publicShare:
            'b50eef93f764af40da7561d302bed1e14707fb73633f60e267b3d4b25fb9a94a56e56301b217ebdf27e6e8e1dcdfcb5de5e9c2fda6aba998b754c8baaba2ebe2',
          privateShare:
            '3e3de1036d07e779451494097d1700ba9554ab384be1a83fd03bbe2ab670e50456e56301b217ebdf27e6e8e1dcdfcb5de5e9c2fda6aba998b754c8baaba2ebe2',
          privateShareProof:
            '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nxk8EaIpAwBMFK4EEAAoCAwRRQgq/FOV/rats/YBQB+bg7L8Z/uIY9OE9uWEy\nl18NwQvnxPDRQSFhXT4gmgSbPhCpKKLz4uACggRPQ48w/iZFzVViMzBlY2Iw\nOWY0ZjEzZmYxNzIxYjBjZGUgPHVzZXItYjMwZWNiMDlmNGYxM2ZmMTcyMWIw\nY2RlQGIzMGVjYjA5ZjRmMTNmZjE3MjFiMGNkZS5jb20+wowEEBMIAD4FgmiK\nQMAECwkHCAmQ+GFfDyTprSUDFQgKBBYAAgECGQECmwMCHgEWIQSrLYVqNCwc\nOgNIraH4YV8PJOmtJQAAjz8BAL2A/ZSVyXqGnQL9e0wlQWMv5RAauVen/sSc\n7ksmTR5CAP9Ou1EUsVAxp82g4stNlmLLxCz+4qYz1Xhe6wckJ5IZF85TBGiK\nQMASBSuBBAAKAgMExA577OmWJP1MOCwofghOiX6RVWzZzkdjrt9cJcpzeDkI\n/8ScaOnQqbwoCmqhOYr0SvdsoRwS+Uw2KIPmy70DFAMBCAfCdwQYEwgAKgWC\naIpAwAmQ+GFfDyTprSUCmwwWIQSrLYVqNCwcOgNIraH4YV8PJOmtJQAAFDgB\nAI7jc6fOBSQPuzWjtswmQPC2K5pk71OoiCNDBW7dixWYAPikuVv70uWB0FA+\nvcg6kUCMCu3PG57kN1cKXrQZnQ8FzjMEaIpAwBYJKwYBBAHaRw8BAQdA1Skn\nocK2X6QzVJIipUbXhwg52vaH6rlJxia1UR0aPnrCeAQYEwgAKgWCaIpAwAmQ\n+GFfDyTprSUCmyAWIQSrLYVqNCwcOgNIraH4YV8PJOmtJQAAfMsBAPJe5buE\n8bUCZR7AZMf4XSZ888GU4CVAvt2zOB8IQwxZAP4lZjF1pBsqP2NN1YLrpe38\njd/uuqBVgPFwyIJ4NUyTag==\n=wznf\n-----END PGP PUBLIC KEY BLOCK-----\n',
          vssProof: '03c8d98bece0c8aae81c59ca77cd3ea76a58bf7d963ca61e06c61b8b2465ff7d',
          gpgKey:
            '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nxk8EaIpAwBMFK4EEAAoCAwRRQgq/FOV/rats/YBQB+bg7L8Z/uIY9OE9uWEy\nl18NwQvnxPDRQSFhXT4gmgSbPhCpKKLz4uACggRPQ48w/iZFzVViMzBlY2Iw\nOWY0ZjEzZmYxNzIxYjBjZGUgPHVzZXItYjMwZWNiMDlmNGYxM2ZmMTcyMWIw\nY2RlQGIzMGVjYjA5ZjRmMTNmZjE3MjFiMGNkZS5jb20+wowEEBMIAD4FgmiK\nQMAECwkHCAmQ+GFfDyTprSUDFQgKBBYAAgECGQECmwMCHgEWIQSrLYVqNCwc\nOgNIraH4YV8PJOmtJQAAjz8BAL2A/ZSVyXqGnQL9e0wlQWMv5RAauVen/sSc\n7ksmTR5CAP9Ou1EUsVAxp82g4stNlmLLxCz+4qYz1Xhe6wckJ5IZF85TBGiK\nQMASBSuBBAAKAgMExA577OmWJP1MOCwofghOiX6RVWzZzkdjrt9cJcpzeDkI\n/8ScaOnQqbwoCmqhOYr0SvdsoRwS+Uw2KIPmy70DFAMBCAfCdwQYEwgAKgWC\naIpAwAmQ+GFfDyTprSUCmwwWIQSrLYVqNCwcOgNIraH4YV8PJOmtJQAAFDgB\nAI7jc6fOBSQPuzWjtswmQPC2K5pk71OoiCNDBW7dixWYAPikuVv70uWB0FA+\nvcg6kUCMCu3PG57kN1cKXrQZnQ8F\n=DJaC\n-----END PGP PUBLIC KEY BLOCK-----\n',
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
    // Mock data key response from KMS
    const mockDataKeyResponse = {
      plaintextKey:
        '115,23,145,49,185,59,87,165,87,53,233,8,177,59,137,233,118,9,5,73,119,147,55,122,141,249,161,156,19,13,224,101',
    };
    nock(kmsUrl).post('/decryptDataKey').reply(200, mockDataKeyResponse);
    nock(kmsUrl).post('/key').reply(200, {
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
          publicShare:
            'b50eef93f764af40da7561d302bed1e14707fb73633f60e267b3d4b25fb9a94a56e56301b217ebdf27e6e8e1dcdfcb5de5e9c2fda6aba998b754c8baaba2ebe2',
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
      encryptedDataKey:
        '1,2,3,0,120,222,140,157,217,111,195,208,47,200,213,217,82,189,16,171,207,16,138,46,228,224,190,138,63,132,239,80,164,8,124,105,140,1,27,61,180,40,45,94,243,196,95,71,146,240,249,140,231,178,0,0,0,126,48,124,6,9,42,134,72,134,247,13,1,7,6,160,111,48,109,2,1,0,48,104,6,9,42,134,72,134,247,13,1,7,1,48,30,6,9,96,134,72,1,101,3,4,1,46,48,17,4,12,115,239,175,219,100,1,209,88,93,117,98,167,2,1,16,128,59,21,22,232,220,65,90,225,157,209,67,125,11,176,151,84,9,229,154,164,67,17,135,158,106,222,220,93,124,231,14,167,59,236,161,55,34,249,62,170,252,0,170,211,100,168,123,50,23,187,247,30,140,221,224,150,25,180,142,14',
      encryptedData:
        '{"iv":"YhMumA0FhhN1jbFODNsYZw==","v":1,"iter":10000,"ks":256,"ts":64,"mode":"ccm","adata":"","cipher":"aes","salt":"ViawevIgxJ0=","ct":"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"}',
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
          'aIpAwAmQFvKwNF9M/BICmwwWIQRyXP44VjLqqZqNDT4W8rA0X0z8EgAAov8B\n' +
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
    result.body.should.have.property('combinedKey');
    result.body.should.have.property('source', 'user');
    result.body.should.have.property(
      'commonKeychain',
      '821273e7e8ad33fd73d4b924bc83322b5a57027b3db9005355153c57d0512a9e97398fa3ac5f3f0cc6d2fe82c8d8b12c85e8ff572b212aa41ba384201552c9e0',
    );
    result.body.should.have.property('counterpartyKeyShare');
    result.body.counterpartyKeyShare.should.have.property('from', 'user');
    result.body.counterpartyKeyShare.should.have.property('to', 'backup');
  });
});
