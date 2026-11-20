/** P6 — Remote control (#439, #438), Send to computer (#511) and the Automation API switch (#499). */
export const remoteControlEn = {
  // Download Settings section
  section: 'Remote control & other apps',
  sectionDescription: 'Control downloads from a computer on your Wi-Fi, or let apps like Tasker add links.',
  rowTitle: 'Remote control',
  rowHintOff: 'Off · Use VidoraX from a browser on the same Wi-Fi',
  rowHintOn: 'On · {url}',
  allowApps: 'Allow other apps to control downloads',
  allowAppsHint:
    'Apps like Tasker can add links, pause all and resume all, and hear when a download finishes (its title only). Off by default.',

  // Remote control screen
  title: 'Remote control',
  intro:
    'Open VidoraX from a computer or tablet on the same Wi-Fi to see your downloads, add links and pause or resume them. Nothing goes over the internet.',
  switchLabel: 'Remote control',
  switchHint:
    'Starts a private page on this phone. It stops after 30 minutes unused, when Wi-Fi is lost, or a minute after you leave VidoraX unless downloads are running.',
  openOnComputer: 'On your computer, open this address',
  copyAddress: 'Copy address',
  addressCopied: 'Address copied',
  pinTitle: 'PIN',
  pinHint: 'Type this PIN in the browser to pair it. A phone or tablet can scan the code to pair in one step.',
  qrA11y: 'QR code with the Remote control address and PIN',
  pinA11y: 'PIN {pin}',
  newPin: 'New PIN',
  locked: 'Too many wrong PINs. Pairing is paused for {seconds} seconds.',
  pinWithdrawn: 'Too many wrong PINs. Tap “New PIN” to pair again.',
  needsWifi: 'Connect to Wi-Fi to use Remote control.',
  startFailed: 'Remote control couldn’t start. Try again.',
  stoppedIdle: 'Remote control stopped after 30 minutes unused.',
  stoppedWifi: 'Remote control stopped because Wi-Fi was lost.',
  stoppedBackground: 'Remote control stopped after you left VidoraX with no downloads running.',
  stoppedError: 'Remote control stopped because of an error.',
  pairedTitle: 'Paired browsers',
  pairedEmpty: 'No browser is paired yet.',
  pairedLastSeen: 'Last used {date}',
  forget: 'Forget',
  forgetA11y: 'Forget {name}',
  forgetAll: 'Forget all browsers',
  forgetAllTitle: 'Forget all browsers?',
  forgetAllMessage: 'Every browser, extension and command line will need a new PIN.',
  sentTitle: 'Sent to computer',
  sentHint: 'What you send appears on your computer under “Sent from phone”.',
  sentEmpty: 'Nothing sent yet. Choose “Send to computer” on a link or a download.',
  sentFile: 'Video file',
  sentLink: 'Link',
  clearSent: 'Clear list',
  removeSentA11y: 'Remove {title} from the list',
  toolsTitle: 'Browser extension and command line',
  toolsHint:
    'The VidoraX Bridge extension for Chrome, Edge and Firefox, and the vidorax-cli script, pair with the same address and PIN.',

  // Send to computer (links and downloads)
  sendToComputer: 'Send to computer',
  sendToComputerHint: 'Adds this to “Sent from phone” in Remote control on your computer',
  sentRunning: 'Sent. It’s under “Sent from phone” on your computer.',
  sentTurnOn: 'Sent. Turn on Remote control to open it on your computer.',
  sendFailed: 'Couldn’t send this.',

  // Privacy policy section
  privacyHeading: 'Remote control and other apps',
  privacyP1:
    'Remote control is off until you turn it on. While it runs, VidoraX serves a private page from your phone on your Wi-Fi network only. A browser, the VidoraX Bridge extension or the command line must first be paired with the PIN shown on your phone; then it can see your downloads, add links, and download what you send to it. The phone keeps only a fingerprint of each pairing, which you can forget at any time.',
  privacyP2:
    'Nothing goes through the internet or any server of ours: the page and its data travel only between your phone and the paired device on your own network. Links added this way are checked on your phone like a pasted link.',
  privacyP3:
    'If you allow other apps to control downloads (off by default), apps such as Tasker can add links, pause or resume all downloads, and receive a notice with the title of a finished download.',
};
