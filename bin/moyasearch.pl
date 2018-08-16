#!/usr/bin/perl
use warnings;
use strict;
use utf8;

use FindBin qw($Bin);
use Encode;
use YAML;
use DateTime;
use Web::Scraper;
use LWP::UserAgent;
use URI::Escape;

binmode STDOUT, ':encoding(utf8)';
binmode FH, ':encoding(utf8)';

open(FH, '<:encoding(utf8)', $Bin . '/../tmp/moyasearch_query.txt');
my $text = join('', <FH>);
close(FH);

exit if($text !~ /^g\s+/);

$text =~ s/^g\s+//g;

my $keyword = '"' . $text . '"';
my $result = &google_it($keyword);

my $post = undef;
if(defined($result->{error2}))
{
	$post = $result->{error2};
}
elsif(defined($result->{error}))
{
	$post = $result->{error};
	$post =~ s/検索ツールをリセット//g;
}
elsif(defined($result->{count}))
{
	$post = $keyword . ' ' . $result->{count};
}
#$post .= ' #moyasearch';

print $post;

sub google_it
{
	my $query = shift || die;
	my $ua = LWP::UserAgent->new(agent => 'Mozilla/5.0 (Windows; U; Windows NT 6.1; en-US) AppleWebKit/534.16 (KHTML, like Gecko) Chrome/10.0.648.151 Safari/534.16');
	#my $res = $ua->get('http://www.google.co.jp/search?q=' . uri_escape_utf8($query) . '&nfpr=1&tbs=li:1&safe=off');
	my $res = $ua->get('http://www.google.co.jp/search?q=' . uri_escape_utf8($query) . '&nfpr=1&safe=off');
	my $google_html = decode('utf8', $res->content);
	#print $google_html;
	
	my $scraper = scraper {
		process 'div#resultStats', 'count' => 'TEXT';
		process 'div#topstuff div.med', 'error' => 'TEXT';
		#process 'div#topstuff div.med p:nth-child(2)', 'error2' => 'TEXT';
		process 'div#topstuff div.med p:nth-child(2)', 'error2' => 'TEXT';
	};
	my $r = $scraper->scrape($google_html);
	#print Dump($r);

	return $r;
}

# vim: noexpandtab
