import { BitGoAPI } from '@bitgo-beta/sdk-api';

export class BitGoAPITestHarness extends BitGoAPI {
  static clearConstantsCache(): void {
    BitGoAPI._constants = {};
    BitGoAPI._constantsExpire = {};
  }
}
