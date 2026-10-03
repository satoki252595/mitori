#!/usr/bin/env ruby
# frozen_string_literal: true

# Prints the ISBN-13 check digit of a 12-digit prefix: ruby scripts/tool.rb 978410101013
module Isbn
  def self.check_digit(prefix)
    sum = prefix.chars.each_with_index.sum { |c, i| c.to_i * (i.even? ? 1 : 3) }
    (10 - sum % 10) % 10
  end
end

puts Isbn.check_digit(ARGV.fetch(0)) if $PROGRAM_NAME == __FILE__
