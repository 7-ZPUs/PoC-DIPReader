-- Tabelle indipendenti (senza chiavi esterne o con dipendenze minime)
CREATE TABLE IF NOT EXISTS archival_process (
    uuid CHAR(36) PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS document_class (
    id INTEGER PRIMARY KEY,
    class_name VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS subject (
    id INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS administrative_procedure (
    id INTEGER PRIMARY KEY NOT NULL,
    catalog_uri VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    subject_of_interest VARCHAR(60)
);

-- Tabelle con dipendenze
CREATE TABLE IF NOT EXISTS aip (
    uuid CHAR(36) PRIMARY KEY,
    document_class_id INTEGER,
    archival_process_uuid CHAR(36),
    root_path VARCHAR(255) NOT NULL,
    FOREIGN KEY (archival_process_uuid) REFERENCES archival_process(uuid),
    FOREIGN KEY (document_class_id) REFERENCES document_class(id)
);

CREATE TABLE IF NOT EXISTS document_aggregation (
    id INTEGER PRIMARY KEY NOT NULL,
    procedure_id INTEGER,
    type VARCHAR(70) NOT NULL,
    FOREIGN KEY (procedure_id) REFERENCES administrative_procedure(id)
);

CREATE TABLE IF NOT EXISTS document (
    id INTEGER PRIMARY KEY,
    root_path VARCHAR(255) NOT NULL,
    aip_uuid CHAR(36) NOT NULL,
    aggregation_id INTEGER,
    FOREIGN KEY (aip_uuid) REFERENCES aip(uuid),
    FOREIGN KEY (aggregation_id) REFERENCES document_aggregation(id)
);

CREATE TABLE IF NOT EXISTS file (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    relative_path VARCHAR(255) NOT NULL,
    root_path VARCHAR(255) NOT NULL,
    is_main BOOLEAN NOT NULL DEFAULT 0, -- In SQLite BOOLEAN è 0 o 1
    document_id INTEGER,
    FOREIGN KEY (document_id) REFERENCES document(id)
);

CREATE TABLE IF NOT EXISTS metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meta_key VARCHAR(255) NOT NULL,
    meta_value VARCHAR(255) NOT NULL,
    document_id INTEGER,
    file_id INTEGER,
    aip_uuid CHAR(36),
    archival_process_uuid CHAR(36),
    meta_type TEXT NOT NULL CHECK (meta_type IN ('string', 'number', 'date')),
    FOREIGN KEY (document_id) REFERENCES document(id),
    FOREIGN KEY (file_id) REFERENCES file(id),
    FOREIGN KEY (aip_uuid) REFERENCES aip(uuid),
    FOREIGN KEY (archival_process_uuid) REFERENCES archival_process(uuid)
);

-- Tabelle dei Soggetti (Specializzazioni)
CREATE TABLE IF NOT EXISTS subject_pf (
    subject_id INTEGER PRIMARY KEY NOT NULL,
    cf CHAR(11) UNIQUE,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    digital_addresses VARCHAR(255),
    FOREIGN KEY (subject_id) REFERENCES subject(id)
);

CREATE TABLE IF NOT EXISTS subject_pg (
    subject_id INTEGER PRIMARY KEY NOT NULL,
    p_iva VARCHAR(11) UNIQUE,
    company_name VARCHAR(255) NOT NULL,
    office_name VARCHAR(255),
    digital_addresses VARCHAR(255),
    FOREIGN KEY (subject_id) REFERENCES subject(id)
);

CREATE TABLE IF NOT EXISTS subject_pai (
    subject_id INTEGER PRIMARY KEY NOT NULL,
    administration_ipa_name VARCHAR(20) NOT NULL,
    administration_aoo_name VARCHAR(20) NOT NULL,
    administration_uor_name VARCHAR(20) NOT NULL,
    digital_addresses VARCHAR(255),
    FOREIGN KEY (subject_id) REFERENCES subject(id)
);

CREATE TABLE IF NOT EXISTS subject_pae (
    subject_id INTEGER PRIMARY KEY NOT NULL,
    administration_name VARCHAR(11) NOT NULL UNIQUE,
    office_name VARCHAR(255),
    digital_addresses VARCHAR(255),
    FOREIGN KEY (subject_id) REFERENCES subject(id)
);

CREATE TABLE IF NOT EXISTS subject_as (
    subject_id INTEGER PRIMARY KEY NOT NULL,
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    cf CHAR(11) UNIQUE,
    organization_name VARCHAR(255) NOT NULL,
    office_name VARCHAR(255) NOT NULL,
    digital_addresses VARCHAR(255),
    FOREIGN KEY (subject_id) REFERENCES subject(id)
);

CREATE TABLE IF NOT EXISTS subject_sq (
    subject_id INTEGER PRIMARY KEY NOT NULL,
    system_name VARCHAR(255) NOT NULL,
    FOREIGN KEY (subject_id) REFERENCES subject(id)
);

-- Tabelle di associazione e fasi
CREATE TABLE IF NOT EXISTS document_subject_association (
    document_id INTEGER NOT NULL,
    subject_id INTEGER NOT NULL,
    PRIMARY KEY (document_id, subject_id),
    FOREIGN KEY (document_id) REFERENCES document(id),
    FOREIGN KEY (subject_id) REFERENCES subject(id)
);

CREATE TABLE IF NOT EXISTS phase (
    id INTEGER PRIMARY KEY NOT NULL,
    type VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    administrative_procedure_id INTEGER,
    FOREIGN KEY (administrative_procedure_id) REFERENCES administrative_procedure(id)
);

-- Create tables only if not present
CREATE TABLE IF NOT EXISTS archival_process (
    uuid CHAR(36) PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS document_class (
    id INTEGER PRIMARY KEY,
    class_name VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS subject (
    id INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS administrative_procedure (
    id INTEGER PRIMARY KEY NOT NULL,
    catalog_uri VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    subject_of_interest VARCHAR(60)
);

CREATE TABLE IF NOT EXISTS aip (
    uuid CHAR(36) PRIMARY KEY,
    document_class_id INTEGER,
    archival_process_uuid CHAR(36),
    FOREIGN KEY (archival_process_uuid) REFERENCES archival_process(uuid),
    FOREIGN KEY (document_class_id) REFERENCES document_class(id)
);

CREATE TABLE IF NOT EXISTS document_aggregation (
    id INTEGER PRIMARY KEY NOT NULL,
    procedure_id INTEGER,
    type VARCHAR(70) NOT NULL,
    FOREIGN KEY (procedure_id) REFERENCES administrative_procedure(id)
);

CREATE TABLE IF NOT EXISTS document (
    id INTEGER PRIMARY KEY,
    root_path VARCHAR(255) NOT NULL,
    aip_uuid CHAR(36) NOT NULL,
    aggregation_id INTEGER,
    FOREIGN KEY (aip_uuid) REFERENCES aip(uuid),
    FOREIGN KEY (aggregation_id) REFERENCES document_aggregation(id)
);

CREATE TABLE IF NOT EXISTS file (
    id INTEGER PRIMARY KEY,
    relative_path VARCHAR(255) NOT NULL,
    root_path VARCHAR(255) NOT NULL,
    is_main BOOLEAN NOT NULL DEFAULT 0,
    document_id INTEGER,
    FOREIGN KEY (document_id) REFERENCES document(id)
);

CREATE TABLE IF NOT EXISTS metadata (
    id INTEGER PRIMARY KEY,
    meta_key VARCHAR(255) NOT NULL,
    meta_value VARCHAR(255) NOT NULL,
    document_id INTEGER,
    aip_uuid CHAR(36),
    archival_process_uuid CHAR(36),
    meta_type TEXT NOT NULL CHECK (meta_type IN ('string', 'number', 'date')),
    FOREIGN KEY (document_id) REFERENCES document(id),
    FOREIGN KEY (aip_uuid) REFERENCES aip(uuid),
    FOREIGN KEY (archival_process_uuid) REFERENCES archival_process(uuid)
);

CREATE TABLE IF NOT EXISTS subject_pf (
    subject_id INTEGER PRIMARY KEY NOT NULL,
    cf CHAR(11) UNIQUE,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    digital_addresses VARCHAR(255),
    FOREIGN KEY (subject_id) REFERENCES subject(id)
);

CREATE TABLE IF NOT EXISTS subject_pg (
    subject_id INTEGER PRIMARY KEY NOT NULL,
    p_iva VARCHAR(11) UNIQUE,
    company_name VARCHAR(255) NOT NULL,
    office_name VARCHAR(255),
    digital_addresses VARCHAR(255),
    FOREIGN KEY (subject_id) REFERENCES subject(id)
);

CREATE TABLE IF NOT EXISTS subject_pai (
    subject_id INTEGER PRIMARY KEY NOT NULL,
    administration_ipa_name VARCHAR(20) NOT NULL,
    administration_aoo_name VARCHAR(20) NOT NULL,
    administration_uor_name VARCHAR(20) NOT NULL,
    digital_addresses VARCHAR(255),
    FOREIGN KEY (subject_id) REFERENCES subject(id)
);

CREATE TABLE IF NOT EXISTS subject_pae (
    subject_id INTEGER PRIMARY KEY NOT NULL,
    administration_name VARCHAR(11) NOT NULL UNIQUE,
    office_name VARCHAR(255),
    digital_addresses VARCHAR(255),
    FOREIGN KEY (subject_id) REFERENCES subject(id)
);

CREATE TABLE IF NOT EXISTS subject_as (
    subject_id INTEGER PRIMARY KEY NOT NULL,
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    cf CHAR(11) UNIQUE,
    organization_name VARCHAR(255) NOT NULL,
    office_name VARCHAR(255) NOT NULL,
    digital_addresses VARCHAR(255),
    FOREIGN KEY (subject_id) REFERENCES subject(id)
);

CREATE TABLE IF NOT EXISTS subject_sq (
    subject_id INTEGER PRIMARY KEY NOT NULL,
    system_name VARCHAR(255) NOT NULL,
    FOREIGN KEY (subject_id) REFERENCES subject(id)
);

CREATE TABLE IF NOT EXISTS document_subject_association (
    document_id INTEGER NOT NULL,
    subject_id INTEGER NOT NULL,
    PRIMARY KEY (document_id, subject_id),
    FOREIGN KEY (document_id) REFERENCES document(id),
    FOREIGN KEY (subject_id) REFERENCES subject(id)
);

CREATE TABLE IF NOT EXISTS phase (
    id INTEGER PRIMARY KEY NOT NULL,
    type VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    administrative_procedure_id INTEGER,
    FOREIGN KEY (administrative_procedure_id) REFERENCES administrative_procedure(id)
);