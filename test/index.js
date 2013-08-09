describe('JS Assets', function () {
  var app;

  // Log with trace: true.
  describe('with tracing', function () {

    before(function (done) {
      app = createTestApp({ log: { trace: true } }, done);
    });

    after(function (done) { app.destroy(done) });

    it('logs with correct callsite', function (done) {
      app.on('log:store', function testStore () {
        return {
          add: function (obj) {
            assert.equal(obj.type, 'test');
            assert.equal(obj.src.file, 'test/basic.js');
            assert.equal(obj.src.line, 29);
            done();
          }
        };
      });

      require('../');

      app.init(function (err) {
        assert.ifError(err);
        app.log('test');
      });
    });
  });
});