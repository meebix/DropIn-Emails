var express = require('express');
var app = express();
var port = process.env.PORT || 3030;

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

var templateDir = path.resolve(__dirname, 'templates', 'july-2016', 'test');
var template = new EmailTemplate(templateDir);

// Handlebars.registerHelper('capitalize', function capitalize (context) {
//   return context.toUpperCase()
// })

// Handlebars.registerPartial('name',
//   '{{ capitalize name.first }} {{ capitalize name.last }}'
// )

// Routes
app.get('/send/:list', function(req, res) {
  // Name of the mailing list before @ {String}
  var mailingList = req.params.list + '@joindropin.com';

  generateEmail(mailingList);
  res.status(200).end();
});

// Mailing Functions
function generateEmail(mailingList) {
  var list = mailgun.lists(mailingList);

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

app.listen(port, function() {
  console.log('Express server listening on port ' + port);
});
