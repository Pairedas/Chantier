// Tests de la logique métier : node chantier/tests/test_logique.js
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const L = new Function(html.split('/*LOGIQUE-DEBUT*/')[1].split('/*LOGIQUE-FIN*/')[0] + '\nreturn L;')();
let n = 0;
const test = (nom, f) => { f(); n++; console.log('ok  ' + nom); };
const T0 = new Date(2026, 9, 2, 10, 0).getTime(), J = '2026-10-02';
const sp = s => s.replace(/[  ]/g, ' ');

test('étapes par défaut', () => {
  const st = L.etatInitial(T0);
  assert.ok(st.etapes.some(e => e.id === 'maconnerie') && st.etapes.some(e => e.id === 'carrelage'));
});

test('dépense quantité × prix unitaire', () => {
  const st = L.etatInitial(T0);
  const d = L.ajouterDepense(st, { etape: 'maconnerie', libelle: 'Briques', quantite: '500', prixUnitaire: '350', fournisseur: 'Quincaillerie Ali' }, T0);
  assert.strictEqual(d.montant, 175000);
  assert.strictEqual(L.paye(d), 175000);
  assert.strictEqual(L.etape(st, 'maconnerie').statut, 'en_cours');
  assert.throws(() => L.ajouterDepense(st, { etape: 'maconnerie', libelle: 'X', montant: '0' }, T0), /Montant/);
  assert.throws(() => L.ajouterDepense(st, { etape: 'maconnerie', libelle: 'X', montant: 10, jour: '2026-10-03' }, T0), /futur/);
});

test('payé en partie puis le reste', () => {
  const st = L.etatInitial(T0);
  const d = L.ajouterDepense(st, { etape: 'carrelage', libelle: 'Carreaux', montant: '400k', payeMaintenant: '150000', moyen: 'wave' }, T0);
  assert.strictEqual(L.resteDu(d), 250000);
  assert.strictEqual(L.totaux(st).resteFactures, 250000);
  L.payer(st, d.id, '100000', 'om', J, T0);
  assert.strictEqual(L.resteDu(d), 150000);
  assert.throws(() => L.payer(st, d.id, '200000', 'om', J, T0), /reste/);
  L.payer(st, d.id, 'tout', 'especes', J, T0);
  assert.strictEqual(L.resteDu(d), 0);
  assert.deepStrictEqual(L.totaux(st).parMoyen.map(x => [x.moyen, x.montant]), [['especes', 150000], ['wave', 150000], ['om', 100000]]);
});

test('artisan au forfait : avances et reste', () => {
  const st = L.etatInitial(T0);
  const a = L.ajouterArtisan(st, { nom: 'Koffi', metier: 'Maçon', etape: 'maconnerie', prixConvenu: '300 000' });
  L.ajouterDepense(st, { etape: 'maconnerie', type: 'main', libelle: 'Avance Koffi', montant: '100000', artisan: a.id }, T0);
  const e = L.etatArtisan(st, a);
  assert.strictEqual(e.verse, 100000); assert.strictEqual(e.reste, 200000);
  const t = L.totaux(st);
  assert.strictEqual(t.resteContrats, 200000);
  assert.strictEqual(t.parEtape.find(x => x.etape.id === 'maconnerie').engage, 300000);
  assert.throws(() => L.supprimerArtisan(st, a.id), /paiements/);
});

test('estimation du coût final', () => {
  const st = L.etatInitial(T0);
  L.reglerEtape(st, 'maconnerie', { budget: '1M' });
  L.reglerEtape(st, 'carrelage', { budget: '500k' });
  L.ajouterDepense(st, { etape: 'maconnerie', libelle: 'Briques', montant: 1200000 }, T0); // dépassement
  L.ajouterDepense(st, { etape: 'carrelage', libelle: 'Carreaux', montant: 200000 }, T0);
  L.ajouterDepense(st, { etape: 'peinture', libelle: 'Peinture', montant: 80000 }, T0);
  L.reglerEtape(st, 'peinture', { statut: 'termine' });
  const t = L.totaux(st);
  assert.strictEqual(t.depense, 1480000);
  assert.strictEqual(t.estimation, 1200000 + 500000 + 80000);
  assert.strictEqual(t.budget, 0);
  assert.strictEqual(t.sommeBudgets, 1500000);
  st.budget = 2000000;
  assert.strictEqual(L.totaux(st).resteBudget, 2000000 - t.estimation);
  assert.strictEqual(t.estimationFiable, false);
  assert.strictEqual(t.parEtape.find(x => x.etape.id === 'maconnerie').resteBudget, -200000);
});

test('saisie en vrac', () => {
  const st = L.etatInitial(T0);
  const r = L.analyserVrac(st, [
    'Briques 300 000', '500 briques à 350', 'ciment 20 sacs x 5 500', 'Fer 150k', 'Carreaux 1,2M', 'Sable 2 voyages 45000',
    'Avance maçon 50 000', 'Transport sable 15000', 'Plomberie :', 'divers truc 7000', 'ligne sans montant',
  ].join('\n'));
  const v = r.map(x => x.erreur ? 'ERR' : [x.libelle, x.montant, x.etape, x.type, x.quantite, x.prixUnitaire].join('|'));
  assert.deepStrictEqual(v, [
    'Briques|300000|maconnerie|materiau||',
    'Briques|175000|maconnerie|materiau|500|350',
    'Ciment|110000|maconnerie|materiau|20|5500',
    'Fer|150000|maconnerie|materiau||',
    'Carreaux|1200000|carrelage|materiau||',
    'Sable|45000|maconnerie|materiau|2|',
    'Avance maçon|50000|maconnerie|main||',
    'Transport sable|15000|divers|transport||',
    'Divers truc|7000|plomberie|materiau||',
    'ERR',
  ]);
  assert.strictEqual(r[2].unite, 'sacs');
  const ajout = L.ajouterVrac(st, r, J, 'especes', T0);
  assert.strictEqual(ajout.length, 9);
  assert.strictEqual(L.totaux(st).depense, 300000 + 175000 + 110000 + 150000 + 1200000 + 45000 + 50000 + 15000 + 7000);
});

test('modifier une dépense', () => {
  const st = L.etatInitial(T0);
  const d = L.ajouterDepense(st, { etape: 'maconnerie', libelle: 'Sable', montant: 50000, payeMaintenant: 30000, fournisseur: 'X' }, T0);
  L.modifierDepense(st, d.id, { etape: 'fondation', libelle: 'Sable fin', montant: 60000 }, T0);
  assert.strictEqual(d.etape, 'fondation'); assert.strictEqual(d.montant, 60000); assert.strictEqual(d.fournisseur, undefined);
  assert.throws(() => L.modifierDepense(st, d.id, { etape: 'fondation', libelle: 'Sable', montant: 20000 }, T0), /déjà payé/);
});

test('bilan texte, CSV, sauvegarde', () => {
  const st = L.etatInitial(T0);
  L.ajouterDepense(st, { etape: 'maconnerie', libelle: 'Briques; rouges', quantite: 500, prixUnitaire: 350 }, T0);
  const t = sp(L.texteBilan(st));
  assert.ok(/Total dépensé : 175 000 F/.test(t), t);
  assert.ok(/Maçonnerie : 175 000 F/.test(t));
  const c = L.csv(st);
  assert.ok(c.includes('"Briques; rouges"') && c.includes(';175000;'));
  const st2 = L.importer(L.exporter(st, T0));
  assert.deepStrictEqual(st2.depenses, st.depenses);
  assert.throws(() => L.importer('{"app":"caisses-herve"}'), /Chantier/);
});

test('dépenses par mois', () => {
  const st = L.etatInitial(T0);
  L.ajouterDepense(st, { etape: 'maconnerie', libelle: 'A', montant: 1000, jour: '2026-07-15' }, T0);
  L.ajouterDepense(st, { etape: 'maconnerie', libelle: 'B', montant: 2000, jour: '2026-10-01' }, T0);
  assert.deepStrictEqual(L.parMois(st, T0).map(x => x.mois + '=' + x.montant), ['2026-07=1000', '2026-08=0', '2026-09=0', '2026-10=2000']);
});

test('vrac : tailles dans le nom, mètres, titres d’étape', () => {
  const st = L.etatInitial(T0);
  const r = L.analyserVrac(st, 'Électricité :\nCâble 3x1,5 : 30 m à 700\nCiment (paquet) : 1 à 5000\nPlomberie :\nRéductions 75/32 : 3 à 1000\nCoude 110 : 1 à 2000\nFil TH rouge, bleu, jaune-vert 1,5 : 150 m à 200');
  assert.deepStrictEqual(r.map(x => [x.etape, x.libelle, x.quantite, x.unite, x.prixUnitaire, x.montant].join('|')), [
    'electricite|Câble 3x1,5|30|m|700|21000',
    'electricite|Ciment (paquet)|1||5000|5000',
    'plomberie|Réductions 75/32|3||1000|3000',
    'plomberie|Coude 110|1||2000|2000',
    'plomberie|Fil TH rouge bleu jaune-vert 1,5|150|m|200|30000',
  ]);
});

console.log('\n' + n + ' tests réussis');
