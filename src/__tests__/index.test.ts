import 'should';

describe('Basic test setup', () => {
  it('should pass a basic test', () => {
    true.should.be.true();
  });

  it('should handle basic math', () => {
    (1 + 1).should.equal(2);
  });
});
