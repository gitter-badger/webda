"use strict";
var assert = require("assert");
var Webda = require("../core.js");
var config = require("./config.json");
var user1;
var user2;
var ident1;
var ident2;
var executor;
var ctx;
var mapper = function (identStore, userStore) {
  var eventFired = 0;
  var events = ['Store.Save','Store.Saved','Store.Get','Store.Delete','Store.Deleted','Store.Update','Store.Updated','Store.Find','Store.Found'];
  for (let evt in events) {
    identStore.on(events[evt], function (evt) {
      eventFired++;
    });
  }

  return userStore.save({'name': 'test'}).then( function (user) {
    user1 = user.uuid;
    return userStore.get(user1);
  }).then( function(user) {
    // Save a user and add an ident
    assert.notEqual(user, undefined);
    user1 = user.uuid;
    return identStore.save({"type": "facebook", "user": user.uuid});
  }).then( function(ident) {
    ident1 = ident;
    return userStore.get(user1);
  }).then( function(user) {
    // Verify the ident is on the user
    assert.notEqual(user, undefined);
    assert.notEqual(user.idents, undefined);
    assert.equal(user.idents.length, 1);    
    return identStore.save({"type": "google", "user": user.uuid});
  }).then( function(ident) {
    // Add a second ident and check it is on the user aswell
    ident2 = ident;
    return userStore.get(user1);
  }).then( function(user) {
    assert.equal(user.idents.length, 2);
    ident2.type = 'google2';
    // Update ident2 to check mapper update
    return identStore.update(ident2);
  }).then( function() {
    return userStore.get(user1);
  }).then( function(user) {
    assert.equal(user.idents.length, 2);
    assert.equal(user.idents[1].type, "google2");
    return identStore.delete(ident1.uuid);
  }).then( function() {
    return userStore.get(user1);
  }).then( function(user) {
    assert.equal(user.idents.length, 1);
    assert.equal(user.idents[0].type, "google2");
    // Add a second user to play
    return userStore.save({"name": "test2"});
  }).then ( function(user) {
    ident2.user = user2 = user.uuid;
    // Move ident2 from user1 to user2
    return identStore.update(ident2);
  }).then( function() {
    // Check user1 has no more ident
    return userStore.get(user1);
  }).then( function(user) {
    assert.equal(user.idents.length, 0);
    // Check user2 has one ident
    return userStore.get(user2);
  }).then( function(user) {
    assert.equal(user.idents.length, 1);
    assert.equal(user.idents[0].type, "google2");
    // Verify you cannot update a collection from update
    return userStore.update({"idents": []}, user2);
  }).then( function() {
    return userStore.get(user2);
  }).then( function(user) {
    assert.equal(user.idents.length, 1);
    assert.equal(user.idents[0].type, "google2");
    // Verify delete cascade with empty collection
    return userStore.delete(user1);
  }).then( function() {
    return userStore.get(user2);
  }).then( function(user) {
    assert.equal(user.idents.length, 1);
    assert.equal(user.idents[0].type, "google2");
    // Verify delete cascade
    return userStore.delete(user2);
  }).then( function() {
    return identStore.get(ident2.uuid);
  }).then( function(ident) {
    assert.equal(ident, undefined);
    assert.equal(eventFired, 13);
  });
}

var crud = function (identStore,userStore) {
  var eventFired = 0;
  var events = ['Store.Save','Store.Saved','Store.Get','Store.Delete','Store.Deleted','Store.Update','Store.Updated','Store.Find','Store.Found'];
  for (let evt in events) {
    identStore.on(events[evt], function (evt) {
      eventFired++;
    });
  }
  // Check CREATE - READ
  return identStore.save({"test": "plop", 'cool': '','lastUsed': new Date(), 'arr': [], 'details': {'plop': 'plop1', 'clean':undefined, 'yop': 'pouf'}}).then (function (object) {
    ident1 = object;
    assert.equal(eventFired, 2);
    assert.notEqual(object, undefined);
    eventFired = 0;
    return identStore.get(ident1.uuid);
  }).then (function (getter) {
    assert.equal(eventFired, 1);
    eventFired = 0;
    assert.notEqual(getter, undefined);
    assert.notEqual(getter.lastUsed, undefined);
    assert.notEqual(getter.lastUpdate, undefined);
    assert.equal(getter.uuid, ident1.uuid);
    assert.equal(getter.test, ident1.test);
    
    // Check UPDATE
    getter.test = "plop2"
    getter.details.plop = "plop2";
    getter.details.blank = '';
    getter.details.bouzouf = undefined;
    getter.empty = [];
    return identStore.update(getter);
  }).then (function (object) {
    assert.equal(eventFired, 2);
    eventFired = 0;
    return identStore.get(ident1.uuid);
  }).then (function (object) {
    assert.equal(object.test, "plop2");
    assert.equal(object.details.plop, "plop2");
    return identStore.get(object.uuid);
  }).then (function (getter) {
    assert.equal(eventFired, 2);
    eventFired = 0;
    assert.equal(getter.test, "plop2");
    // Check DELETE
    return identStore.delete(ident1.uuid);
  }).then (function () {
    assert.equal(eventFired, 2);
    eventFired = 0;
    return identStore.get(ident1.uuid);
  }).then (function (getter) {
    assert.equal(eventFired, 1);
    eventFired = 0;
    assert.equal(getter, undefined);
  });
};

var skipDynamo = true;
var skipMongo = true;
describe('Store', function() {
    var webda;
    var identStore;
    var userStore;
    before (function () {
      skipMongo = process.env["WEBDA_MONGO_URL"] === undefined;
      skipDynamo = process.env["WEBDA_AWS_KEY"] === undefined;
      if (skipDynamo) {
        console.log("Not running DynamoStore test as no AWS env found");
      }
      if (skipMongo) {
        console.log("Not running MongoStore test as no MONGO env found");
      }
    });
    beforeEach(function () {
      webda = new Webda(config);
      webda.setHost("test.webda.io");
      webda.initAll();
    });
    describe('FileStore', function() {
      beforeEach(function () {
        identStore = webda.getService("Idents");
        userStore = webda.getService("Users");
        assert.notEqual(identStore, undefined);
        assert.notEqual(userStore, undefined);
        identStore.__clean();
        userStore.__clean();
      });
      it('Basic CRUD', function() { return crud(identStore, userStore); });
      it('Mapper', function() { return mapper(identStore, userStore); });
    });
    describe('Store', function() {
      var eventFired = 0;
      // Check Store HTTP mapping
      it('HTTP CRUD', function() {
        webda.setHost("test.webda.io");
        ctx = webda.newContext({"type": "CRUD", "uuid": "PLOP"});
        ctx.session.login("fake_user", "fake_ident");
        executor = webda.getExecutor(ctx, "test.webda.io", "POST", "/users");
        assert.notEqual(executor, undefined);
        return executor.execute(ctx).then( () => {
          ctx.body = undefined;
          return webda.getExecutor(ctx, "test.webda.io", "GET", "/users/PLOP").execute(ctx);
        }).then( () => {
          assert.notEqual(ctx._body, undefined);
          assert.equal(ctx._body.indexOf("lastUpdate") >= 0, true);
          ctx.body = {"type": "CRUD2", "uuid": "PLOP"};
          executor = webda.getExecutor(ctx, "test.webda.io", "POST", "/users");
          return executor.execute(ctx);
        }).catch( (err) => {
          assert.equal(err, 409);
          // Verify the none overide of UUID
          ctx.body = {"type": "CRUD2", "uuid": "PLOP2"};
          executor = webda.getExecutor(ctx, "test.webda.io", "PUT", "/users/PLOP");
          return executor.execute(ctx);
        }).then( () => {
          return userStore.get("PLOP");
        }).then ( (user) => {
          assert.equal(user.uuid, "PLOP");
          assert.equal(user.type, "CRUD2");
          ctx._body = undefined;
          return webda.getExecutor(ctx, "test.webda.io", "DELETE", "/users/PLOP").execute(ctx);
        }).then( () => {
          eventFired = 0;
          return webda.getExecutor(ctx, "test.webda.io", "GET", "/users/PLOP").execute(ctx);
        }).catch( (err) => {
          eventFired++;
          assert.equal(err, 404);
          return webda.getExecutor(ctx, "test.webda.io", "DELETE", "/users/PLOP").execute(ctx);
        }).catch( (err) => {
          eventFired++;
          assert.equal(err, 404);
          return webda.getExecutor(ctx, "test.webda.io", "PUT", "/users/PLOP").execute(ctx);
        }).catch( (err) => {
          eventFired++;
          assert.equal(err, 404);
        }).then ( () => {
          assert.equal(eventFired, 3);
        });
      });
    });
    describe('MongoStore', function() {
      beforeEach(function () {
        if (skipMongo) {
          return;
        }
        identStore = webda.getService("mongoidents");
        userStore = webda.getService("mongousers");
        assert.notEqual(identStore, undefined);
        assert.notEqual(userStore, undefined);
        return identStore.__clean().then (function() {
          return userStore.__clean();
        }).catch (function(err) {
          console.log(err);
          return Promise.reject(err);
        });
      });
      it('Basic CRUD', function() { if (skipMongo) { this.skip(); return; } return crud(identStore, userStore); });
      it('Mapper', function() { if (skipMongo) { this.skip(); return; } return mapper(identStore, userStore); });
    });
    describe('DynamoStore', function() {
      var uuids = {};
      beforeEach(function () {
        if (skipDynamo) {
          return;
        }
        identStore = webda.getService("dynamoidents");
        userStore = webda.getService("dynamousers");
        assert.notEqual(identStore, undefined);
        assert.notEqual(userStore, undefined);

        return identStore.__clean().then (function() {
          return userStore.__clean();
        });
      });
      it('Basic CRUD', function() { if (skipDynamo) { this.skip(); return; } return crud(identStore, userStore); });
      it('Mapper', function() { if (skipDynamo) { this.skip(); return; } return mapper(identStore, userStore); });
      it('Date handling', function() {
        if (skipDynamo) { this.skip(); return; }
        return userStore.save({"uuid": "testUpdate", "subobject": {"empty": "", "t": {"plop": ""}, "date": new Date()}}).then ( () => {
          return userStore.get("testUpdate");
        }).then ((user) => {
          assert.notEqual(user.date, {});
        });
      });
    });
    describe('DynamoStore', function() {
      it('Body cleaning', function() {
        //var parse = require("./data/to_clean.json");
        userStore = webda.getService("dynamousers");
        let clean = userStore._cleanObject({arr: [{value:'', test: 'oki'},{value:''},{value:'Test'}], sub: {value:''}})
        assert.equal(clean.sub.value, undefined);
        assert.equal(clean.arr instanceof Array, true);
        assert.equal(clean.arr[0].value, undefined);
        assert.equal(clean.arr[1].value, undefined);
        assert.notEqual(clean.arr[2].value, undefined);
      });
    });
});