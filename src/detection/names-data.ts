/** Small bundled first-name lists (heuristic aid only; not exhaustive). Accent-folded, lowercase. */
const FR = `jean pierre michel philippe alain patrick nicolas christophe christian daniel bernard jacques frederic laurent stephane olivier eric david julien thomas
sebastien guillaume maxime alexandre antoine vincent romain mathieu benoit fabrice thierry pascal didier gerard marc francois paul louis henri hugo lucas jules arthur
gabriel raphael theo nathan enzo clement florian adrien yann sylvain cedric damien franck gilles herve serge denis claude rene andre roger bruno remi
marie nathalie isabelle sylvie catherine francoise martine christine monique nicole sophie valerie anne brigitte veronique stephanie sandrine laurence celine julie
camille lea chloe manon emma ines sarah laura pauline charlotte aurelie delphine caroline virginie corinne emilie elodie claire helene agnes odile patricia
jeanne louise alice juliette margaux anais clementine mathilde madeleine genevieve josette yvette colette simone lucie noemie maelle capucine`;
const EN = `james john robert michael william david richard joseph thomas charles christopher daniel matthew anthony mark donald steven paul andrew joshua kenneth kevin brian george
edward ronald timothy jason jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott brandon benjamin samuel frank gregory raymond alexander patrick jack dennis jerry tyler
aaron henry adam douglas nathan peter zachary kyle walter harold jeremy ethan carl keith roger gerald christian terry sean arthur austin noah lawrence jesse joe bryan billy bruce
mary patricia jennifer linda elizabeth barbara susan jessica sarah karen nancy lisa betty margaret sandra ashley kimberly emily donna michelle carol amanda dorothy melissa deborah
stephanie rebecca sharon laura cynthia kathleen amy angela shirley anna brenda pamela emma nicole helen samantha katherine christine debra rachel carolyn janet catherine maria heather
diane olivia julie joyce victoria kelly christina lauren joan evelyn judith megan cheryl andrea hannah jacqueline martha gloria teresa ann sara madison frances kathryn janice jean abigail
alan oliver harry george charlie jacob oscar leo freddie alfie archie sophie charlotte amelia isla ava mia ruby lily grace chloe`;
export const FIRST_NAMES: ReadonlySet<string> = new Set(`${FR} ${EN}`.split(/\s+/).filter(Boolean));

/** Capitalised function words that must never be treated as (part of) a name. */
export const STOPWORDS: ReadonlySet<string> = new Set(`le la les un une des du de et ou dans pour par sur avec sans sous chez ce cet cette ces son sa ses leur leurs notre nos votre vos au aux
the a an and or in for on at by with to of is was were are be been this that these those his her its their our your from as if it he she they we you
article articles monsieur madame mademoiselle maitre societe cabinet tribunal cour conseil ministere republique france paris lyon marseille
mr mrs ms miss dr sir dame judge justice court company limited partie parties demandeur defendeur plaintiff defendant claimant respondent`.split(/\s+/));
