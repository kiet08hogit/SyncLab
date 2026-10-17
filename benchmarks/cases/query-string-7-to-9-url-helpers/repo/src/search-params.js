const HELP = 'Campaign links carry query-string utm parameters such as utm_source.';

function utmSource(url) {
  return new URL(url).searchParams.get('utm_source');
}

module.exports = { utmSource, HELP };
