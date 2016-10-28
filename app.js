var express = require('express');
var app = express();
var port = process.env.PORT || 3030;

var api_key = process.env.MG_API_KEY;
var domain = 'joindropin.com';
var mailgun = require('mailgun-js')({apiKey: api_key, domain: domain});

var Parse = require('parse/node');
Parse.initialize(process.env.PARSE_ID);
Parse.serverURL = process.env.PARSE_SERVER_URL;

var path = require('path');
var curl = require('curlrequest');
var EmailTemplate = require('email-templates').EmailTemplate;
var templateDir = path.resolve(__dirname, 'templates', 'july-2016', 'active-rewards');
var template = new EmailTemplate(templateDir);
var _ = require('lodash');
var moment = require('moment');
var timezone = require('moment-timezone');
var Handlebars = require('handlebars');
var groupBy = require('handlebars-group-by');

var templateDir = path.resolve(__dirname, 'templates', 'july-2016', 'active-rewards');
var template = new EmailTemplate(templateDir);

// Handlebars Helpers
Handlebars.registerHelper(groupBy(Handlebars));

// Custom Handlebar Helpers
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

Handlebars.registerHelper('greaterThan', function(value, number, options) {
  if (value > number) {
    return options.fn(this);
  }

  return options.inverse(this);
});



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
  // console.log('1');
  var list = mailgun.lists(mailingList);
  var masterData = {};

  list.members().list().then(function(data) {
    // console.log('2');
    masterData.pageCount = Math.ceil(data.total_count / 100);
    masterData.getMembersUrl = 'https://api.mailgun.net/v3/lists/' + mailingList + '/members/pages';

    return masterData;
  }, function(err) {
    console.log('Error retrieving mailing list contacts: ' + err);
  })
  .then(function(masterData) {
    // console.log('3');
    getAddress(masterData.pageCount, masterData.getMembersUrl);
  });
};


// Utility Functions
var getAddress = function(pageCount, url) {
  --pageCount;

  // console.log('4');
  var promise = new Parse.Promise();
  var options = {
    url: url,
    user: 'api:' + process.env.MG_API_KEY
  };

  curl.request(options, function(err, data) {
    // console.log('5');
    var results = JSON.parse(data);
    var nextUrl = results.paging.next.toString();
    var promises = [];

    _.each(results.items, function(item) {
      var prepareData = function() {
        // console.log('Start Promise');
        var userData = {};
        // User
        var User = Parse.Object.extend('User');
        var userQuery = new Parse.Query(User);

        userQuery.equalTo('email', item.address);
        return userQuery.first().then(function(userObj) {
          // console.log('7');
          return userObj;
        }, function(err) {
          console.log('Error retrieving user: ' + err);
        })
        .then(function(userObj) {
          // console.log('8');
          userData.user = userObj;
          userData.email = userObj.attributes.email;

          // Users Rewards
          var UsersRewards = Parse.Object.extend('Users_Rewards');
          var usersRewardsQuery = new Parse.Query(UsersRewards);

          var today = moment().minute(0).second(0).millisecond(0)._d;
          var sevenDaysForward = moment().add(7, 'days').minute(0).second(0).millisecond(0)._d;

          usersRewardsQuery.equalTo('userId', userObj);
          usersRewardsQuery.equalTo('userHasRedeemed', false);
          usersRewardsQuery.lessThanOrEqualTo('rewardActiveStart', sevenDaysForward);
          usersRewardsQuery.greaterThanOrEqualTo('rewardActiveEnd', today);
          usersRewardsQuery.include('barId');
          usersRewardsQuery.include('userId');
          return usersRewardsQuery.find().then(function(rewards) {
            // console.log('9');
            userData.rewards = rewards;

            return userData;
          }, function(err) {
            console.log('Error retrieving users rewards: ' + err);
          })
          .then(function(userData) {
            // console.log('10');
            var Timeline = Parse.Object.extend('Users_Timeline');

            var today = moment().minute(0).second(0).millisecond(0)._d;
            var sevenDaysAgo = moment().subtract(7, 'days').minute(0).second(0).millisecond(0)._d;

            var rewardEarnedType = new Parse.Query(Timeline);
            var referralRewardType = new Parse.Query(Timeline);
            rewardEarnedType.equalTo('eventType', 'Reward Earned');
            referralRewardType.equalTo('eventType', 'Referral Reward');

            var timelineQuery = Parse.Query.or(rewardEarnedType, referralRewardType);

            timelineQuery.equalTo('userId', userData.user);
            timelineQuery.lessThanOrEqualTo('date', today);
            timelineQuery.greaterThanOrEqualTo('date', sevenDaysAgo);
            return timelineQuery.count().then(function(total) {
              // console.log('11');
              userData.rewardsEarned = total;

              return userData;
            }, function(err) {
              console.log('Error retrieving timeline: ' + err);
            })
            .then(function(userData) {
              // console.log('12');
              // Image selection
              var randomNumberUpTo5 = Math.ceil(Math.random() * 5);
              var s3Url = 'https://s3.amazonaws.com/joindropin.com/emails/hero-images/hero-image-{number}.jpg';
              var imageUrl = s3Url.replace('{number}', randomNumberUpTo5);

              userData.heroImage = imageUrl;

              return userData;
            })
            .then(function(userData) {
              // console.log('13');
              return template.render(userData).then(function(template) {
                // console.log('14');
                var emailData = {
                  from: 'Drop In <hello@joindropin.com>',
                  to: userData.email,
                  subject: 'My Rewards Available This Week',
                  html: template.html
                };

                if (userData.rewards.length) {
                  console.log(userData.email + ', ' + 'Successfully sent the email to this user.');
                  // return mailgun.messages().send(emailData).then(function(result) {
                  //   console.log(userData.email + ', ' + 'Successfully sent the email to this user.');
                  // }, function(err) {
                  //   console.log(userData.email + ', ' + 'There was an error sending the email to this user: ' + {error: error});
                  // });
                } else {
                  console.log(userData.email + ', ' + 'This user was skipped because they have no rewards meeting the criteria to send the email.');
                }
              });
            });
          });
        });
        // console.log('End Promise');
      };

      promises.push(prepareData());
    });

    // console.log('Return promise');
    return Parse.Promise.when(promises).then(function() {
      if (pageCount > 0) {
        console.log('XXXXXXXXXXXXXXXXXXXXXXXXXX', pageCount, nextUrl);
        return getAddress(pageCount, nextUrl);
      }
    });
  });
};


// Start Server
app.listen(port, function() {
  console.log('Express server listening on port ' + port);
});
