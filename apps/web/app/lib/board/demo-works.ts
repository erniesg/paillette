/**
 * A fixed set of real National Gallery of Art open-access works, used to drive
 * the board demo at /night/deal without a search backend or an API key.
 *
 * Extracted from the checked-in spotlight bundles under
 * `apps/web/public/search-spotlights/nga/`. Only works whose images are served
 * from NGA's public IIIF endpoint are included — the bundles also carry
 * session-gated asset URLs that 401 for anonymous viewers, and those are no use
 * for a demo or a screenshot.
 *
 * `motif` is the spotlight the work was drawn from. The demo uses it as a
 * stand-in for visual similarity so a redeal has something deterministic to
 * move towards; the real board gets that from Rocchio over CLIP embeddings.
 */

import type { LightTableWork } from '~/components/board/light-table-card';

export interface DemoWork extends LightTableWork {
  motif: string;
}

export const DEMO_WORKS: DemoWork[] = [
  {
    id: 'open-access-art:nga:41623',
    title: 'The Mourning Madonna',
    artist: 'Master of the Franciscan Crucifixes',
    dateText: '1270',
    accession: '1952.5.13',
    motif: 'paintings across the collection',
    imageUrl:
      'https://api.nga.gov/iiif/a0eb9fb8-28a3-4446-b28d-70a4cc50c6e5/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/a0eb9fb8-28a3-4446-b28d-70a4cc50c6e5/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:18016',
    title: 'Sofa',
    artist: 'Ferdinand Cartier',
    dateText: '1942',
    accession: '1943.8.5816',
    motif: 'Index of American Design',
    imageUrl:
      'https://api.nga.gov/iiif/e8cf1ae8-bc62-4c14-9ea3-b06ba38ee4c4/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/e8cf1ae8-bc62-4c14-9ea3-b06ba38ee4c4/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:46102',
    title: 'Madonna and Child Enthroned with Saint Peter and Saint Paul',
    artist: 'Domenico di Bartolo',
    dateText: '1430',
    accession: '1961.9.3',
    motif: 'The Feast of the Gods',
    imageUrl:
      'https://api.nga.gov/iiif/6cdc6222-4662-4ae2-8609-7ccbb695f0fa/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/6cdc6222-4662-4ae2-8609-7ccbb695f0fa/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:46',
    title: 'The Annunciation',
    artist: 'Jan van Eyck',
    dateText: '1434',
    accession: '1937.1.39',
    motif: 'The Annunciation',
    imageUrl:
      'https://api.nga.gov/iiif/46633bd6-4834-40fb-8ce0-fb975c731dc1/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/46633bd6-4834-40fb-8ce0-fb975c731dc1/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:34093',
    title: 'Phoebe Cassidy Freeman (Mrs. Clarkson Freeman)',
    artist: 'Jacob Eichholtz',
    dateText: '1830',
    accession: '1947.17.45',
    motif: 'women in profile',
    imageUrl:
      'https://api.nga.gov/iiif/1c84ef3c-698d-46c5-b1e1-6a9c60a01856/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/1c84ef3c-698d-46c5-b1e1-6a9c60a01856/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:46101',
    title: 'The Crucifixion',
    artist: 'Bernardo Daddi',
    dateText: '1320',
    accession: '1961.9.2',
    motif: 'paintings across the collection',
    imageUrl:
      'https://api.nga.gov/iiif/33f1330d-2ca0-4f9c-97c9-ee767667d64c/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/33f1330d-2ca0-4f9c-97c9-ee767667d64c/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:16469',
    title: 'Armchair',
    artist: 'Arthur Johnson',
    dateText: '1937',
    accession: '1943.8.4266',
    motif: 'Index of American Design',
    imageUrl:
      'https://api.nga.gov/iiif/5792133a-f167-47f4-94c7-744725000294/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/5792133a-f167-47f4-94c7-744725000294/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:1140',
    title: 'Madonna and Child with Saint Jerome and Saint Bernardino of Siena',
    artist: 'Benvenuto di Giovanni',
    dateText: '1480',
    accession: '1942.9.3',
    motif: 'The Feast of the Gods',
    imageUrl:
      'https://api.nga.gov/iiif/70681fcc-b40a-4147-9803-c632037b4f74/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/70681fcc-b40a-4147-9803-c632037b4f74/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:46308',
    title: 'Pentecost',
    artist: 'German 13th Century',
    dateText: '1225',
    accession: '1961.17.4',
    motif: 'The Annunciation',
    imageUrl:
      'https://api.nga.gov/iiif/9ae561f1-2930-488e-bed7-55962e442199/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/9ae561f1-2930-488e-bed7-55962e442199/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:107',
    title: 'Mrs. John Taylor',
    artist: 'Thomas Gainsborough',
    dateText: '1778',
    accession: '1937.1.100',
    motif: 'women in profile',
    imageUrl:
      'https://api.nga.gov/iiif/ce6561c4-2c7f-4355-9fea-fa3c1efa4b53/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/ce6561c4-2c7f-4355-9fea-fa3c1efa4b53/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:41624',
    title: 'The Mourning Saint John the Evangelist',
    artist: 'Master of the Franciscan Crucifixes',
    dateText: '1270',
    accession: '1952.5.14',
    motif: 'paintings across the collection',
    imageUrl:
      'https://api.nga.gov/iiif/cbfa8d2d-dd02-4101-94be-15413ecf717f/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/cbfa8d2d-dd02-4101-94be-15413ecf717f/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:20316',
    title: 'Presentation Basket',
    artist: 'Gordena Jackson',
    dateText: '1935',
    accession: '1943.8.8118',
    motif: 'Index of American Design',
    imageUrl:
      'https://api.nga.gov/iiif/75229f76-ddfb-4c89-b155-6352b4bf395d/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/75229f76-ddfb-4c89-b155-6352b4bf395d/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:46054',
    title: 'St. Dionysius',
    artist: 'Portuguese 15th Century',
    dateText: '1475',
    accession: '1960.6.30.1',
    motif: 'The Feast of the Gods',
    imageUrl:
      'https://api.nga.gov/iiif/a04287a1-4953-46a0-8b28-0ddd62711544/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/a04287a1-4953-46a0-8b28-0ddd62711544/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:3664',
    title: 'The Annunciation',
    artist: 'German 15th Century',
    dateText: '1450',
    accession: '1943.3.452',
    motif: 'The Annunciation',
    imageUrl:
      'https://api.nga.gov/iiif/d97634b4-00e6-44e7-be7f-484982fe2c0e/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/d97634b4-00e6-44e7-be7f-484982fe2c0e/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:75751',
    title: 'Hellene von Sleben',
    artist: 'European 19th Century',
    dateText: '1800',
    accession: '1992.87.4',
    motif: 'women in profile',
    imageUrl:
      'https://api.nga.gov/iiif/b46af0cb-71f4-4a05-8981-6e111c7b558d/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/b46af0cb-71f4-4a05-8981-6e111c7b558d/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:357',
    title: 'The Angel of the Annunciation',
    artist: 'Simone Martini',
    dateText: '1330',
    accession: '1939.1.216',
    motif: 'paintings across the collection',
    imageUrl:
      'https://api.nga.gov/iiif/1b266771-5762-4ce0-8968-688cae2ba81e/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/1b266771-5762-4ce0-8968-688cae2ba81e/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:27809',
    title: '"Barnacle Bill" Puppet',
    artist: 'Chris Makrenos',
    dateText: '1938',
    accession: '1943.8.15718',
    motif: 'Index of American Design',
    imageUrl:
      'https://api.nga.gov/iiif/68f1fb40-95a6-418e-85d4-837faff0aa82/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/68f1fb40-95a6-418e-85d4-837faff0aa82/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:1138',
    title: 'The Feast of the Gods',
    artist: 'Giovanni Bellini and Titian',
    dateText: '1514',
    accession: '1942.9.1',
    motif: 'The Feast of the Gods',
    imageUrl:
      'https://api.nga.gov/iiif/3a640014-a2f0-4cd4-b440-979f62316da2/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/3a640014-a2f0-4cd4-b440-979f62316da2/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:46169',
    title: 'The Presentation and Marriage of the Virgin, and the Annunciation',
    artist: 'Benedetto Diana',
    dateText: '1520',
    accession: '1961.9.70',
    motif: 'The Annunciation',
    imageUrl:
      'https://api.nga.gov/iiif/e1c55e22-1e29-4116-9d1e-9c1b5036a776/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/e1c55e22-1e29-4116-9d1e-9c1b5036a776/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:61099',
    title: 'Head of a Young Woman',
    artist: 'Eastman Johnson',
    dateText: '1875',
    accession: '1982.4.4',
    motif: 'women in profile',
    imageUrl:
      'https://api.nga.gov/iiif/970685c4-44c8-4fa6-afc3-c07c6858ca8d/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/970685c4-44c8-4fa6-afc3-c07c6858ca8d/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:282',
    title: 'The Calling of the Apostles Peter and Andrew',
    artist: 'Duccio di Buoninsegna',
    dateText: '1308',
    accession: '1939.1.141',
    motif: 'paintings across the collection',
    imageUrl:
      'https://api.nga.gov/iiif/8c36f19a-c3c2-450f-b6b7-5217d1eafc82/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/8c36f19a-c3c2-450f-b6b7-5217d1eafc82/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:27773',
    title: '"Bell Hop" Marionette',
    artist: 'Emile Cero',
    dateText: '1938',
    accession: '1943.8.15682',
    motif: 'Index of American Design',
    imageUrl:
      'https://api.nga.gov/iiif/7af76414-7fca-4fc1-a6e9-e41138d2ba81/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/7af76414-7fca-4fc1-a6e9-e41138d2ba81/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:54073',
    title: 'Martyrdom of a Female Saint',
    artist: 'Follower of Francesco Fontebasso',
    dateText: '1700',
    accession: '1973.64.10',
    motif: 'The Feast of the Gods',
    imageUrl:
      'https://api.nga.gov/iiif/b581952d-e323-483a-a8be-393afd820317/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/b581952d-e323-483a-a8be-393afd820317/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:34663',
    title: 'The Annunciation to the Virgin',
    artist: 'Belbello da Pavia',
    dateText: '1450',
    accession: '1948.11.21',
    motif: 'The Annunciation',
    imageUrl:
      'https://api.nga.gov/iiif/6006bbfb-c973-4d3e-80df-3324ecbacb2d/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/6006bbfb-c973-4d3e-80df-3324ecbacb2d/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:75772',
    title: 'Elizabeth Marius Kemper',
    artist: 'American 19th Century, after Charles B. J. Févret de Saint-Mémin',
    dateText: '1800',
    accession: '1992.87.34',
    motif: 'women in profile',
    imageUrl:
      'https://api.nga.gov/iiif/90bdb1d1-d02a-4075-8a00-dbf9071362f7/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/90bdb1d1-d02a-4075-8a00-dbf9071362f7/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:1',
    title: 'Saint Paul and a Group of Worshippers',
    artist: 'Bernardo Daddi',
    dateText: '1333',
    accession: '1937.1.3',
    motif: 'paintings across the collection',
    imageUrl:
      'https://api.nga.gov/iiif/7bbcfd01-e774-46e7-96d1-a3b03598cd8a/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/7bbcfd01-e774-46e7-96d1-a3b03598cd8a/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:93943',
    title: 'Wendingen',
    artist: 'El Lissitzky',
    dateText: '1921',
    accession: '1995.77.4',
    motif: 'Index of American Design',
    imageUrl:
      'https://api.nga.gov/iiif/f5b758cb-7d21-4327-bc2f-f869b7317731/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/f5b758cb-7d21-4327-bc2f-f869b7317731/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:103363',
    title: 'Pax with the Resurrected Christ Appearing to the Disciples',
    artist: 'Italian 16th Century (Probably Roman), after Valerio Belli',
    dateText: '1534',
    accession: '1997.114.1',
    motif: 'The Feast of the Gods',
    imageUrl:
      'https://api.nga.gov/iiif/23605ccb-d512-4901-b27b-e76e22a4e4ea/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/23605ccb-d512-4901-b27b-e76e22a4e4ea/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:36528',
    title: 'The Nativity with the Annunciation to the Shepherds',
    artist: 'Master of the Dominican Effigies',
    dateText: '1340',
    accession: '1949.5.87',
    motif: 'The Annunciation',
    imageUrl:
      'https://api.nga.gov/iiif/3b465bdc-823f-4734-b725-5ffd9b3bc08b/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/3b465bdc-823f-4734-b725-5ffd9b3bc08b/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:42154',
    title: 'Jeanne Hading',
    artist: 'Henri de Toulouse-Lautrec',
    dateText: '1896',
    accession: '1952.8.419',
    motif: 'women in profile',
    imageUrl:
      'https://api.nga.gov/iiif/bd7f01b0-78ff-4e50-8eff-51ac39db3d33/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/bd7f01b0-78ff-4e50-8eff-51ac39db3d33/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:41635',
    title: 'Saint James Major',
    artist: 'Simone Martini',
    dateText: '1315',
    accession: '1952.5.25',
    motif: 'paintings across the collection',
    imageUrl:
      'https://api.nga.gov/iiif/c05d6828-ce1c-4333-8ec6-b79ba3472fef/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/c05d6828-ce1c-4333-8ec6-b79ba3472fef/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:76766',
    title: 'Plate 6: From Portfolio "Folk Art of Rural Pennsylvania"',
    artist: 'American 20th Century',
    dateText: '1939',
    accession: '1943.8.18221',
    motif: 'Index of American Design',
    imageUrl:
      'https://api.nga.gov/iiif/7bdf35ee-8ecc-4525-8227-2622ec220dcc/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/7bdf35ee-8ecc-4525-8227-2622ec220dcc/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:132096',
    title: 'A Ceiling with Apollo Presiding over Military and Historical Learning',
    artist: 'Anton Kern',
    dateText: '1740',
    accession: '2005.80.1',
    motif: 'The Feast of the Gods',
    imageUrl:
      'https://api.nga.gov/iiif/e1c68427-84f5-4d80-9a85-6dfca1d02301/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/e1c68427-84f5-4d80-9a85-6dfca1d02301/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:42800',
    title: 'Coronation of the Virgin with Attendant Saints',
    artist: 'Follower of Johannes von Valkenburg',
    dateText: '1325',
    accession: '1953.6.246',
    motif: 'The Annunciation',
    imageUrl:
      'https://api.nga.gov/iiif/78346717-13dd-4dfc-a5f4-f5adc0ea94e9/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/78346717-13dd-4dfc-a5f4-f5adc0ea94e9/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:215198',
    title: 'Elizabeth Porcher Gaillard Stoney',
    artist: 'Charles B. J. Févret de Saint-Mémin',
    dateText: '1809',
    accession: '2015.19.1584.44.15',
    motif: 'women in profile',
    imageUrl:
      'https://api.nga.gov/iiif/3ec7801e-e9c6-4ec3-95c8-3a52c12722fb/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/3ec7801e-e9c6-4ec3-95c8-3a52c12722fb/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:41625',
    title: 'Saint James Minor',
    artist: 'Master of Saint Francis',
    dateText: '1272',
    accession: '1952.5.15',
    motif: 'paintings across the collection',
    imageUrl:
      'https://api.nga.gov/iiif/b21ae2a3-8f77-47d9-ac02-04fce864c313/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/b21ae2a3-8f77-47d9-ac02-04fce864c313/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:28130',
    title: 'Wall Paper and Border',
    artist: 'Sidney Liswood',
    dateText: '1937',
    accession: '1943.8.16039',
    motif: 'Index of American Design',
    imageUrl:
      'https://api.nga.gov/iiif/e5f25c86-4160-4985-9a8a-03ba015fc29f/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/e5f25c86-4160-4985-9a8a-03ba015fc29f/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:39233',
    title: 'Coronation of the Virgin with the Trinity and Saints',
    artist: 'Olivetan Master',
    dateText: '1440',
    accession: '1950.17.2',
    motif: 'The Feast of the Gods',
    imageUrl:
      'https://api.nga.gov/iiif/003b2cee-af6e-47a4-86eb-cb49d0e58eb8/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/003b2cee-af6e-47a4-86eb-cb49d0e58eb8/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:226409',
    title: 'The Annunciation',
    artist: 'Caterina Angela Pierozzi',
    dateText: '1677',
    accession: '2023.3.1',
    motif: 'The Annunciation',
    imageUrl:
      'https://api.nga.gov/iiif/acc982bc-99e8-4af2-9c1d-1fc9dffd262d/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/acc982bc-99e8-4af2-9c1d-1fc9dffd262d/full/500,/0/default.jpg',
  },
  {
    id: 'open-access-art:nga:148253',
    title: 'Honeysuckle',
    artist: 'Frederick W. Freer',
    dateText: '1887',
    accession: '2008.115.1933',
    motif: 'women in profile',
    imageUrl:
      'https://api.nga.gov/iiif/97b9a366-7c36-48ca-98f9-775a5f2f54b5/full/843,/0/default.jpg',
    thumbnailUrl:
      'https://api.nga.gov/iiif/97b9a366-7c36-48ca-98f9-775a5f2f54b5/full/500,/0/default.jpg',
  },
];
