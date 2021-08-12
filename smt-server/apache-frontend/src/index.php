<?php

// This script shows in its most basic format a connection check
// to CAS using SAML1.1

// Load the CAS lib
require_once 'phpCAS/CAS.php';

// Enable debugging
phpCAS::setLogger();
// Enable verbose error messages. Disable in production!
phpCAS::setVerbose(true);

// Initialize phpCAS
phpCAS::client(SAML_VERSION_1_1, 'cas.cosmos.esa.int', 443, '/cas');

// For quick testing you can disable SSL validation of the CAS server.
// Do not use this in production!
phpCAS::setNoCasServerValidation();

// Force CAS authentication on any page that includes this file
phpCAS::forceAuthentication();

?>
<html>
<head>
<title>Advanced SAML 1.1 example</title>
</head>
<body>

<p>
Version PHP:
<?php
// affiche le numéro de version courante du PHP.
echo 'Version PHP courante : ' . phpversion();

// affiche e.g. '2.0' ou rien du tout si cette extension n'est pas active
echo phpversion('tidy');
?>
</p>

<h2>Advanced SAML 1.1 example</h2>
Authentication succeeded for user
<strong><?php echo phpCAS::getUser(); ?></strong>.

<h3>User Attributes</h3>
<ul>
<?php
foreach (phpCAS::getAttributes() as $key => $value) {
if (is_array($value)) {
echo '<li>', $key, ':<ol>';
foreach ($value as $item)

{ echo '<li><strong>', $item, '</strong></li>'; }
echo '</ol></li>';
} else

{ echo '<li>', $key, ': <strong>', $value, '</strong></li>' . PHP_EOL; }
}
?>
