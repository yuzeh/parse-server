'use strict'
// These tests check the "find" functionality of the REST API.
var auth = require('../src/Auth');
var cache = require('../src/cache');
var Config = require('../src/Config');
var rest = require('../src/rest');

var querystring = require('querystring');
var request = require('request');
var rp = require('request-promise');

var config = new Config('test');
let database = config.database;
var nobody = auth.nobody(config);

describe('rest query', () => {
  it('basic query', (done) => {
    rest.create(config, nobody, 'TestObject', {}).then(() => {
      return rest.find(config, nobody, 'TestObject', {});
    }).then((response) => {
      expect(response.results.length).toEqual(1);
      done();
    });
  });

  it('query with limit', (done) => {
    rest.create(config, nobody, 'TestObject', {foo: 'baz'}
    ).then(() => {
      return rest.create(config, nobody,
                         'TestObject', {foo: 'qux'});
    }).then(() => {
      return rest.find(config, nobody,
                       'TestObject', {}, {limit: 1});
    }).then((response) => {
      expect(response.results.length).toEqual(1);
      expect(response.results[0].foo).toBeTruthy();
      done();
    });
  });

  var data = {
    username: 'blah',
    password: 'pass',
    sessionToken: 'abc123',
  }

  it_exclude_dbs(['postgres'])('query for user w/ legacy credentials without masterKey has them stripped from results', done => {
    database.create('_User', data).then(() => {
      return rest.find(config, nobody, '_User')
    }).then((result) => {
      var user = result.results[0];
      expect(user.username).toEqual('blah');
      expect(user.sessionToken).toBeUndefined();
      expect(user.password).toBeUndefined();
      done();
    });
  });

  it_exclude_dbs(['postgres'])('query for user w/ legacy credentials with masterKey has them stripped from results', done => {
    database.create('_User', data).then(() => {
      return rest.find(config, {isMaster: true}, '_User')
    }).then((result) => {
      var user = result.results[0];
      expect(user.username).toEqual('blah');
      expect(user.sessionToken).toBeUndefined();
      expect(user.password).toBeUndefined();
      done();
    });
  });

  // Created to test a scenario in AnyPic
  it_exclude_dbs(['postgres'])('query with include', (done) => {
    var photo = {
      foo: 'bar'
    };
    var user = {
      username: 'aUsername',
      password: 'aPassword'
    };
    var activity = {
      type: 'comment',
      photo: {
        __type: 'Pointer',
        className: 'TestPhoto',
        objectId: ''
      },
      fromUser: {
        __type: 'Pointer',
        className: '_User',
        objectId: ''
      }
    };
    var queryWhere = {
      photo: {
        __type: 'Pointer',
        className: 'TestPhoto',
        objectId: ''
      },
      type: 'comment'
    };
    var queryOptions = {
      include: 'fromUser',
      order: 'createdAt',
      limit: 30
    };
    rest.create(config, nobody, 'TestPhoto', photo
    ).then((p) => {
      photo = p;
      return rest.create(config, nobody, '_User', user);
    }).then((u) => {
      user = u.response;
      activity.photo.objectId = photo.objectId;
      activity.fromUser.objectId = user.objectId;
      return rest.create(config, nobody,
                         'TestActivity', activity);
    }).then(() => {
      queryWhere.photo.objectId = photo.objectId;
      return rest.find(config, nobody,
                       'TestActivity', queryWhere, queryOptions);
    }).then((response) => {
      var results = response.results;
      expect(results.length).toEqual(1);
      expect(typeof results[0].objectId).toEqual('string');
      expect(typeof results[0].photo).toEqual('object');
      expect(typeof results[0].fromUser).toEqual('object');
      expect(typeof results[0].fromUser.username).toEqual('string');
      done();
    }).catch((error) => { console.log(error); });
  });

  it_exclude_dbs(['postgres'])('query non-existent class when disabled client class creation', (done) => {
    var customConfig = Object.assign({}, config, {allowClientClassCreation: false});
    rest.find(customConfig, auth.nobody(customConfig), 'ClientClassCreation', {})
      .then(() => {
        fail('Should throw an error');
        done();
      }, (err) => {
        expect(err.code).toEqual(Parse.Error.OPERATION_FORBIDDEN);
        expect(err.message).toEqual('This user is not allowed to access ' +
                                    'non-existent class: ClientClassCreation');
        done();
    });
  });

  it_exclude_dbs(['postgres'])('query existent class when disabled client class creation', (done) => {
    var customConfig = Object.assign({}, config, {allowClientClassCreation: false});
    config.database.loadSchema()
    .then(schema => schema.addClassIfNotExists('ClientClassCreation', {}))
    .then(actualSchema => {
      expect(actualSchema.className).toEqual('ClientClassCreation');
      return rest.find(customConfig, auth.nobody(customConfig), 'ClientClassCreation', {});
    })
    .then((result) => {
      expect(result.results.length).toEqual(0);
      done();
    }, err => {
      fail('Should not throw error')
    });
  });

  it('query with wrongly encoded parameter', (done) => {
    rest.create(config, nobody, 'TestParameterEncode', {foo: 'bar'}
    ).then(() => {
      return rest.create(config, nobody,
                         'TestParameterEncode', {foo: 'baz'});
    }).then(() => {
      var headers = {
        'X-Parse-Application-Id': 'test',
        'X-Parse-REST-API-Key': 'rest'
      };
      
      let p0 = rp.get({
        headers: headers,
        url: 'http://localhost:8378/1/classes/TestParameterEncode?'
                         + querystring.stringify({
                             where: '{"foo":{"$ne": "baz"}}',
                             limit: 1
                         }).replace('=', '%3D'),
      }).then(fail, (response) => {
        let error = response.error;
        var b = JSON.parse(error);
        expect(b.code).toEqual(Parse.Error.INVALID_QUERY);
      });

      let p1 = rp.get({
        headers: headers,
        url: 'http://localhost:8378/1/classes/TestParameterEncode?'
                         + querystring.stringify({
                             limit: 1
                         }).replace('=', '%3D'),
      }).then(fail, (response) => {
        let error = response.error;
        var b = JSON.parse(error);
        expect(b.code).toEqual(Parse.Error.INVALID_QUERY);
      });
      return Promise.all([p0, p1]);
    }).then(done).catch((err) => {
      console.error(err);
      fail('should not fail');
      done();
    })
  });

  it('query with limit = 0', (done) => {
    rest.create(config, nobody, 'TestObject', {foo: 'baz'}
    ).then(() => {
      return rest.create(config, nobody,
        'TestObject', {foo: 'qux'});
    }).then(() => {
      return rest.find(config, nobody,
        'TestObject', {}, {limit: 0});
    }).then((response) => {
      expect(response.results.length).toEqual(0);
      done();
    });
  });

  it_exclude_dbs(['postgres'])('query with limit = 0 and count = 1', (done) => {
    rest.create(config, nobody, 'TestObject', {foo: 'baz'}
    ).then(() => {
      return rest.create(config, nobody,
        'TestObject', {foo: 'qux'});
    }).then(() => {
      return rest.find(config, nobody,
        'TestObject', {}, {limit: 0, count: 1});
    }).then((response) => {
      expect(response.results.length).toEqual(0);
      expect(response.count).toEqual(2);
      done();
    });
  });
});
