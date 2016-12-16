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

app.get('/unsubscribe/:email', function(req, res) {
  var emailAddress = req.params.email;

  mailgun.unsubscribes().create({address: emailAddress, tag: '*'}, function (error, body) {
    if (error) {
      console.log(emailAddress + ' could not be unsubscribed from the Drop In mailing list: ' + error);
      res.status(500).send('Unfortunately, there was an error unsubscribing your email address. Please contact support@joindropin.com.');
    } else {
      console.log(emailAddress + ' has been unsubscribed from the Drop In mailing list.');
      res.status(200).send('You have successfully been unsubscribed from the Drop In mailing lists.');
    }
  });
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
  var masterData = {};

  list.members().list({limit: 1}).then(function(data) {
    masterData.pageCount = data.total_count;
    masterData.getMembersUrl = 'https://api.mailgun.net/v3/lists/' + mailingList + '/members/pages';

    return masterData;
  }, function(err) {
    console.log('Error retrieving mailing list contacts: ' + err);
  })
  .then(function(masterData) {
    getAddress(masterData.pageCount, masterData.getMembersUrl);
    res.send('Sending emails to members of: ' + mailingList);
  });
};


// Utility Functions
var getAddress = function(pageCount, url) {
  var options = {
    url: url,
    user: 'api:' + process.env.MG_API_KEY
  };

  curl.request(options, function(err, data) {
    var results = JSON.parse(data);
    var nextUrl = results.paging.next.toString();
    var promise = Parse.Promise.as();

    _.each(results.items, function(item) {
      promise = promise.then(function() {
        var userData = {};
        // User
        var User = Parse.Object.extend('User');
        var userQuery = new Parse.Query(User);

        userQuery.equalTo('email', item.address);
        return userQuery.first().then(function(userObj) {
          console.log('User: ', userObj);

          return userObj;
        }, function(err) {
          console.log('Error retrieving user: ' + err);
        })
        .then(function(userObj) {
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
            var preparedRewards = [];

            _.each(rewards, function(result) {
              var meta = {};

              meta.barName = result.attributes.barId.attributes.name;
              meta.rewardName = result.attributes.rewardName;
              meta.startDate = timezone(result.attributes.rewardActiveStart).tz("America/New_York").format("MMMM Do, h:mma");
              meta.endDate = timezone(result.attributes.rewardActiveEnd).tz("America/New_York").format("MMMM Do, h:mma");

              preparedRewards.push(meta);
            });

            userData.rewards = preparedRewards;
            return userData;
          }, function(err) {
            console.log('Error retrieving users rewards: ' + err);
          })
          .then(function(userData) {
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
              userData.rewardsEarned = total;

              return userData;
            }, function(err) {
              console.log('Error retrieving timeline: ' + err);
            })
            .then(function(userData) {
              // Image selection
              var randomNumberUpTo5 = Math.ceil(Math.random() * 5);
              var s3Url = 'https://s3.amazonaws.com/joindropin.com/emails/hero-images/hero-image-{number}.jpg';
              var imageUrl = s3Url.replace('{number}', randomNumberUpTo5);

              userData.heroImage = imageUrl;

              return userData;
            })
            .then(function(userData) {
              return template.render(userData).then(function(template) {
                console.log('----------------');
                console.log('userData: ', userData);
                var emailData = {
                  from: 'Drop In <hello@joindropin.com>',
                  to: userData.email,
                  subject: 'Join us for the Drop In Holiday Happy Hour next Wed!',
                  html: template.html
                };

                if (userData.rewards.length) {
                  return mailgun.messages().send(emailData).then(function(result) {
                    console.log(userData.email + ', ' + 'Successfully sent the email to this user.');
                  }, function(err) {
                    console.log(userData.email + ', ' + 'There was an error sending the email to this user: ' + {error: error});
                  });
                } else {
                  console.log(userData.email + ', ' + 'This user was skipped because they have no rewards meeting the criteria to send the email.');
                }
              });
            });
          });
        });
      });
    });

    return promise;
  });
};


// Start Server
app.listen(port, function() {
  console.log('Express server listening on port ' + port);
});
