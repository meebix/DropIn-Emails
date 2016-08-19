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
var Promise = require('bluebird');
var moment = require('moment');
var timezone = require('moment-timezone');
var Handlebars = require('handlebars');
var groupBy = require('handlebars-group-by');
Handlebars.registerHelper(groupBy(Handlebars));
Handlebars.registerHelper('grouped_each', function(every, context, options) {
  var out = "", subcontext = [], i;
  if (context && context.length > 0) {
    for (i = 0; i < context.length; i++) {
      if (i > 0 && i % every === 0) {
        out += options.fn(subcontext);
        subcontext = [];
      }
      subcontext.push(context[i]);
    }
    out += options.fn(subcontext);
  }
  return out;
});

var templateDir = path.resolve(__dirname, 'templates', 'july-2016', 'active-rewards');
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

  generateEmail(req, res, mailingList);
});

app.get('/resubscribe/:email', function(req, res) {
  var emailAddress = req.params.email;

  mailgun.unsubscribes(emailAddress).delete(function (error, body) {
    if (error) {
      console.log(emailAddress + ' could not be resubscribed to the Drop In mailing list: ' + error);
      res.status(500).send(emailAddress + ' could not be resubscribed to the Drop In mailing list.');
    } else {
      console.log(emailAddress + ' has been resubscribed to the Drop In mailing list.');
      res.status(200).send(emailAddress + ' has been resubscribed to the Drop In mailing list.');
    }
  });
});

// Mailing Functions
function generateEmail(req, res, mailingList) {
  var list = mailgun.lists(mailingList);

  list.members().list(function (err, data) {
    _.each(data.items, function(results) {
      var allData = {};
      var today = moment().minute(0).second(0).millisecond(0)._d;

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
        allData.email = user.attributes.email;

        // Users Rewards
        var UsersRewards = Parse.Object.extend('Users_Rewards');
        var usersRewardsQuery = new Parse.Query(UsersRewards);

        var sevenDaysForward = moment().add(7, 'days').minute(0).second(0).millisecond(0)._d;

        usersRewardsQuery.equalTo('userId', user);
        usersRewardsQuery.equalTo('userHasRedeemed', false);
        usersRewardsQuery.lessThanOrEqualTo('rewardActiveStart', sevenDaysForward);
        usersRewardsQuery.greaterThanOrEqualTo('rewardActiveEnd', today);
        usersRewardsQuery.include('barId');
        usersRewardsQuery.include('userId');
        return usersRewardsQuery.find().then(function(results) {
          var rewards = [];

          _.each(results, function(result) {
            var meta = {};

            meta.barName = result.attributes.barId.attributes.name;
            meta.rewardName = result.attributes.rewardName;
            meta.startDate = timezone(result.attributes.rewardActiveStart).tz("America/New_York").format("MMMM Do, h:mma");
            meta.endDate = timezone(result.attributes.rewardActiveEnd).tz("America/New_York").format("MMMM Do, h:mma");

            rewards.push(meta);
          });

          allData.rewards = rewards;
          return allData;
        }, function(error) {
          console.log('Error retrieving users rewards objects: ' + error);
        }) // End Users Rewards
        .then(function(allData) {
          // User
          var User = Parse.Object.extend('User');
          var userQuery = new Parse.Query(User);

          userQuery.equalTo('email', allData.email);
          userQuery.first().then(function(user) {
            return user;
          }, function(error) {
            console.log('Error retrieving user: ' + error);
          })
          .then(function(user) {
            var Timeline = Parse.Object.extend('Users_Timeline');
            var timelineQuery = new Parse.Query(Timeline);

            var sevenDaysAgo = moment().subtract(7, 'days').minute(0).second(0).millisecond(0)._d;

            timelineQuery.equalTo('userId', user);
            timelineQuery.equalTo('eventType', 'Reward Earned');
            timelineQuery.lessThanOrEqualTo('date', today);
            timelineQuery.greaterThanOrEqualTo('date', sevenDaysAgo);
            return timelineQuery.count().then(function(total) {
              allData.rewardsEarned = total;

              return allData;
            }, function(error) {
              console.log(error);
            })
            .then(function(allData) {
              // Image selection
              var randomNumberUpTo5 = Math.ceil(Math.random() * 5);
              var s3Url = 'https://s3.amazonaws.com/joindropin.com/emails/hero-images/hero-image-{number}.jpg';
              var imageUrl = s3Url.replace('{number}', randomNumberUpTo5);

              allData.heroImage = imageUrl;

              return allData;
            })
            .then(function(allData) {
              template.render(allData)
              .then(function (template) {
                var emailData = {
                  from: 'Drop In <hello@joindropin.com>',
                  to: allData.email,
                  subject: 'My Rewards Available This Week',
                  html: template.html
                };

                mailgun.messages().send(emailData, function (error, body) {
                  if (error) {
                    console.log('There was an error sending emails to the mailing list: ' + error);
                    res.status(400).send('There was an error sending emails to the mailing list: ' + error);
                  } else {
                    console.log('Successfully sent email to mailing list: ' + mailingList);
                    res.status(200).send('Successfully sent email to mailing list: ' + mailingList);
                  }
                });
              });

            });
          })
        });

      });

    });
  });
};


// Start Server
app.listen(port, function() {
  console.log('Express server listening on port ' + port);
});
