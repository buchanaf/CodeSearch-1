var cheerio = require('cheerio');
var request = require('request');

var exec = require('child_process').exec;
var Promise = require("bluebird");
var reqProm = Promise.promisify(request);
var execProm = Promise.promisify(exec);

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
var config = require('./lib/config/config');
var db = require('mongoose').connect(config.mongo.uri, config.mongo.options);

var pushRepo = require('./lib/controllers/files').pushFileToDirectory;

var npmURL = 'https://www.npmjs.org';
var startUrl = 'https://www.npmjs.org/browse/star';
var starThresh = 50;

var scrapeCloneUrl = function(response, body) {
  if (response.statusCode === 200) {
    var $ = cheerio.load(body);
    var stars = +$('a.social-count.js-social-count').text();
    // console.log('Found repo:', repoHref, 'Stars:', stars);

    if ( stars >= starThresh ) {
      var cloneUrl = $('input.clone.js-url-field').val();
      console.log('Repo has more than 50 stars', cloneUrl );
      return cloneUrl;
    }
  }
};

var scrapeRepoLink = function(response, body) {
  if ( response.statusCode == 200 ) {
    var $ = cheerio.load(body);
    var repoLink;

    var repoEl = $('.metadata a').filter(function() {

      var linkText = $(this).text();
      var repoUrlSubstring = linkText.substring(linkText.length - 4);
      return repoUrlSubstring === '.git';

    }).each(function() {
      repoLink = $(this).attr('href');
    });

    return repoLink;
  }
};

var scrapeStarredLinks = function(response, body) {
  // console.log('body', response[0].body);
  var $ = cheerio.load( body );

  var starredRepoLinks = $('.row a');
  var paginationLinks = $('h1+ .description a');

  var starredLinksArr = [];
  var nextPageLink;

  starredRepoLinks.each(function(idx, link) {
    starredLinksArr.push( npmURL + '/browse/depended/' + $(this).text() );
  });

  paginationLinks.each(function(idx, link) {
    var text = $(this).text()
                      .substring(0, $(this).text().length - 2);

    if ( text === 'next' ) {
      nextPageLink = npmURL + $(this).attr('href');
    }
  });

  return [starredLinksArr, nextPageLink];
};

var scrapeDependedLinks = function(response, body) {
  if ( response.statusCode == 200 ) {
    var $ = cheerio.load(body);

    var moduleLinks = $('.row a');
    var nextPageLinks = $('h1+ .description a');

    var moduleLinksArr = [];
    var nextPageLink;

    moduleLinks.each(function(idx, el) {
      moduleLinksArr.push( npmURL + $(this).attr('href') );
    });

    nextPageLinks.each(function(idx, el) {
      var text = $(this).text()
                        .substring(0, $(this).text().length - 2);

      if ( text === 'next' ) {
        nextPageLink = npmURL + $(this).attr('href');
      }
    });
  }

  return [moduleLinksArr, nextPageLink];
};

var cloneRepo = function(cloneUrl) {
  if ( !cloneUrl ) {
    return;
  }

  console.log('cloning', cloneUrl);

  if ( process.cwd().lastIndexOf('reposToParse') === -1 ) {
    try {
      process.chdir('reposToParse');
      console.log('New directory: ' + process.cwd());
    } catch (err) {
      console.log('chdir: ' + err);
    }
  }

  return execProm('git clone ' + cloneUrl ).spread(function(stdout, stderr) {
      console.log('stdout:', stdout);
      console.log('stderr:', stderr);
      var moduleName = cloneUrl.substring( cloneUrl.lastIndexOf('/') + 1, cloneUrl.lastIndexOf('.git') );
      var repoPath = process.cwd() + '/' + moduleName;
      // return repoPath;
      console.log([repoPath, cloneUrl.substring(0, cloneUrl.lastIndexOf('.git') ), moduleName]);
      return [repoPath, cloneUrl, moduleName];
  })
  .spread(pushRepo)
  .catch(function(e) {
    console.log('exec error: ' + e);
  });
};

var getCloneUrl = function(repoHref) {
  if ( !repoHref ) {
    return;
  }

  return reqProm(repoHref).spread(scrapeCloneUrl)
    .catch(function(err) {
      console.log('ERROR requesting github', err, '\n', repoHref);
    });
};

var getRepoUrl = function(pageLink) {
  if ( !pageLink ) {
    return;
  }

  return reqProm(pageLink).spread(scrapeRepoLink)
    .catch(function(err) {
      console.log('Err requesting NPM Page', err, '\n', pageLink);
    });
};

var getDependingPage = function(dependedUrl) {

  return reqProm(dependedUrl).spread(scrapeDependedLinks)
    .spread(function(depLinks, nextPageLink) {
      Promise.resolve(depLinks)
        .map(getRepoUrl)
        .map(getCloneUrl)
        .map(cloneRepo, {concurrency: 8})
        .then(function() {
          if ( nextPageLink ) {
            console.log(' > \033[35mSERVER:\033[39m GetDependedPage nextLink', nextLink);
            getDependingPage(nextPageLink);
          }
        });
  });
};

var getStarredPage = function(starredUrl) {
  reqProm(starredUrl).spread(scrapeStarredLinks)
    .spread(function(repoLinks, nextLink) {

      return Promise.resolve(repoLinks)
        .each(getDependingPage)
        .then(function() {
          if (nextLink) {
            console.log(' > \033[35mSERVER:\033[39m GetStarredPage nextLink', nextLink);
            getStarredPage(nextLink);
          }
        })
        .catch(function(err) {
          console.log('ERROR: getStarredPage promise resolve', err);
        });
  })
  .catch(function(err) {
    console.log('ERROR: getStarredPage', err);
  });
};

getStarredPage(startUrl);
