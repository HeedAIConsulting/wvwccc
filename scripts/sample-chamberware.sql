-- Synthetic fixture that mimics a ChamberWare MySQL dump (for testing the importer only).
-- NOT real member data.
DROP TABLE IF EXISTS `accounts`;
CREATE TABLE `accounts` (
  `accounts_id` int(11) NOT NULL AUTO_INCREMENT,
  `company` varchar(255) DEFAULT NULL,
  `category` varchar(120) DEFAULT NULL,
  `firstname` varchar(80) DEFAULT NULL,
  `lastname` varchar(80) DEFAULT NULL,
  `email` varchar(160) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `phone` varchar(40) DEFAULT NULL,
  `address` varchar(200) DEFAULT NULL,
  `city` varchar(80) DEFAULT NULL,
  `state` varchar(40) DEFAULT NULL,
  `zip` varchar(20) DEFAULT NULL,
  `website` varchar(200) DEFAULT NULL,
  `membership_level` varchar(40) DEFAULT NULL,
  `active` varchar(10) DEFAULT NULL,
  PRIMARY KEY (`accounts_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

INSERT INTO `accounts` (`accounts_id`,`company`,`category`,`firstname`,`lastname`,`email`,`password`,`phone`,`address`,`city`,`state`,`zip`,`website`,`membership_level`,`active`) VALUES
(101,'Sample Bakery LLC','Restaurant','Jane','Doe','jane@samplebakery.test','$2y$10$abcdefghijklmnopqrstuv','(818) 555-1000','1 Test St','Tarzana','CA','91356','https://samplebakery.test','Gold','Y'),
(102,'O\'Connor Law Group','Professional Services','Sean','O\'Connor','sean@oconnorlaw.test','5f4dcc3b5aa765d61d8327deb882cf99','(818) 555-1001','2 Demo Ave, Suite 5','Woodland Hills','CA','91367',NULL,'Platinum','Y'),
(103,'Pending Co','Retail','Pat','Lee','pat@pendingco.test',NULL,'(818) 555-1002',NULL,'Reseda','CA','91335',NULL,'Member','P');
