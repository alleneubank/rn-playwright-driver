require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'RNDriverTouch'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platform       = :ios, '13.4'
  s.swift_version  = '5.4'
  s.source         = { git: 'https://github.com/0xbigboss/rn-playwright-driver' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Uses UIKit private APIs for touch synthesis (same approach as KIF/EarlGrey)
  # No XCTest framework required - works in regular app builds

  s.source_files = '*.swift'
end
