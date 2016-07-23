var api_key = process.env.MG_API_KEY;
var domain = 'joindropin.com';
var mailgun = require('mailgun-js')({apiKey: api_key, domain: domain});

var Parse = require('parse/node');
Parse.initialize(process.env.PARSE_ID);
Parse.serverURL = 'http://parse-uat.us-east-1.elasticbeanstalk.com/parse'

var path = require('path');
var EmailTemplate = require('email-templates').EmailTemplate;
var _ = require('lodash');
var moment = require('moment');
var promise = require('bluebird');
var Handlebars = require('handlebars');

var templateDir = path.resolve(__dirname, '..', 'templates', 'july-2016', 'test');
var template = new EmailTemplate(templateDir);
var list = mailgun.lists('test@joindropin.com');

// Handlebars.registerHelper('capitalize', function capitalize (context) {
//   return context.toUpperCase()
// })

// Handlebars.registerPartial('name',
//   '{{ capitalize name.first }} {{ capitalize name.last }}'
// )


// Render template with data
// var renderTemplateData = function() {
//   var locals = {
//     name: {first: 'Mike', last: 'Donahue'}
//   };

//   template.render(locals)
//   .then(function (results) {
//     var data = {
//       from: 'Mike\'s Code <code@joindropin.com>',
//       to: 'mdonahue@joindropin.com',
//       subject: 'Test: Send to all on mailing list',
//       html: results.html
//     };

//     return data;
//   });
// };

// Send the email
// var sendEmail = function() {
//   var data = {
//     from: 'Mike\'s Code <code@joindropin.com>',
//     to: 'mdonahue@joindropin.com',
//     subject: 'Test: Send to all on mailing list',
//     html: '<p>test</p>'
//   };

//   mailgun.messages().send(data, function (error, body) {
//     if (error) console.log(error);

//     console.log(body);
//   });
// };





// var generateEmails = function() {
//   var promise = Parse.Promise.as();
//   list.members().list(function (err, data) {
//     // Start each
//     _.each(data.items, function(item) {

//       promise = promise.then(function() {
//         var thing = {};

//         var User = Parse.Object.extend('User');
//         var userQuery = new Parse.Query(User);
//         userQuery.equalTo('email', item.address);
//         userQuery.first().then(function(user) {
//           return user;
//         }, function(err) {console.log(err);})
//         .then(function(user) {
//           var UsersRewards = Parse.Object.extend('Users_Rewards');
//           var usersRewardsQuery = new Parse.Query(UsersRewards);
//           var today = moment().minute(0).second(0).millisecond(0)._d;
//           var sevenDaysForward = moment().add(7, 'days').minute(0).second(0).millisecond(0)._d;

//           usersRewardsQuery.equalTo('userId', user);
//           // usersRewardsQuery.equalTo('userHasRedeemed', false);
//           // usersRewardsQuery.greaterThanOrEqualTo('rewardActiveStart', today);
//           // usersRewardsQuery.lessThanOrEqualTo('rewardActiveStart', sevenDaysForward);
//           usersRewardsQuery.include('barId');
//           usersRewardsQuery.limit(1000);
//           return usersRewardsQuery.find().then(function(objs) {
//               var rewards = [];

//             _.forEach(objs, function(value) {
//               var reward = {};

//               reward.bar = value.attributes.barId.attributes.name;
//               reward.user = value.attributes.userId.id;
//               reward.reward = value.attributes.barId.attributes.reward;
//               reward.startDate = value.attributes.rewardActiveStart;
//               reward.endDate = value.attributes.rewardActiveEnd;

//               rewards.push(reward);

//               // template.render(reward)
//               // .then(function (results) {
//               //   var data = {
//               //     from: 'Mike\'s Code <code@joindropin.com>',
//               //     to: 'mdonahue@joindropin.com',
//               //     subject: 'Test: Send to all on mailing list',
//               //     html: results.html
//               //   };

//               //   mailgun.messages().send(data, function (error, body) {
//               //     if (error) console.log(error);

//               //     console.log(body);
//               //   });
//               // });
//             });

//             console.log(rewards);
//             data.rewards = rewards;
//           }, function(err) {console.log(err);});
//         });

//         console.log(thing);
//       });

//     });
//     // End each

//     return promise;
//   });
// };


var generateEmails = function() {
  list.members().list(function (err, data) {
    _.each(data.items, function(results) {

      // User
      var User = Parse.Object.extend('User');
      var userQuery = new Parse.Query(User);

      userQuery.equalTo('email', results.address);
      userQuery.first().then(function(user) {
        return user;
      }, function(error) {
        console.log('Error retrieving user: ' + error);
      }) // End User
      .then(function(user) {

        // Users Rewards
        var UsersRewards = Parse.Object.extend('Users_Rewards');
        var usersRewardsQuery = new Parse.Query(UsersRewards);

        var today = moment().minute(0).second(0).millisecond(0)._d;
        var sevenDaysForward = moment().add(7, 'days').minute(0).second(0).millisecond(0)._d;

        usersRewardsQuery.equalTo('userId', user);
        usersRewardsQuery.equalTo('userHasRedeemed', false);
        usersRewardsQuery.greaterThanOrEqualTo('rewardActiveStart', today);
        usersRewardsQuery.lessThanOrEqualTo('rewardActiveStart', sevenDaysForward);
        usersRewardsQuery.include('barId');
        return usersRewardsQuery.find().then(function(results) {
          var rewards = [];

          _.each(results, function(result) {
            var meta = {};

            meta.barName = result.attributes.barId.attributes.name;
            meta.rewardName = result.attributes.rewardName;
            meta.startDate = result.attributes.rewardActiveStart;
            meta.endDate = result.attributes.rewardActiveEnd;

            rewards.push(meta);
          });

          return rewards;
        }, function(error) {
          console.log('Error retrieving users rewards objects: ' + error);
        }) // End Users Rewards
        .then(function(rewards) {
          var final = {
            rewards: rewards
          };

          template.render(final)
          .then(function (template) {
            var emailData = {
              from: 'Mike\'s Code <code@joindropin.com>',
              to: 'mdonahue@joindropin.com',
              subject: 'Test: Send to all on mailing list',
              html: template.html
            };

            mailgun.messages().send(emailData, function (error, body) {
              if (error) console.log(error);

              console.log(body);
            });
          });

        });

      });

    });
  });
};

generateEmails();


// Asnyc
//
// var generateEmails = function(cb) {
//   var pipeline = {
//     renderTemplateData: renderTemplateData,
//     sendEmail: sendEmail
//   };

//   async.series(pipeline, function(error, results) {
//     if (error) console.log(error);

//     var functions = {
//       renderTemplateData: results.renderTemplateData,
//       sendEmail: results.sendEmail
//     };

//     return cb(null, functions);
//   });
// };

// generateEmails(function(error, functions) {
//   if (error) console.log(error);
//   return functions.sendEmail;
// });


// var Schema = mongoose.Schema
// var model = new Schema({}, {collection: '_User'});
// var myModel = mongoose.model('_User', model);
// var instance = new myModel();
// instance.test = 'b';
// console.log(instance);
// instance.save(function (err) {
//   if (err) console.log(err);
// });
//

// myModel.find({}, function (err, docs) {
//   console.log(docs);
// });
//
// list.members().list(function (err, data) {
//   console.log(data.items);
// }, function(err) {
//   console.log(err);
// });
