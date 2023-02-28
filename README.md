# WebChangeListener

Little bot listening for a website to change its content. If it does, it sends an alert using the contactor bot (if available).
It allows to exclude pages and selectors from the check (useful for dynamic content).

## Installation
1. Clone the repository
2. Install the dependencies with `npm install`

## Usage

You can use the bot with the following command:

    node index.js <url> --interval=<interval> [--exclude-page=<url>] [--exclude-selector=<url> <selector>]