CREATE TABLE metadata(
    INTEGER id PRIMARY KEY,
    VARCHAR(255) meta_key NOT NULL,
    VARCHAR(255) meta_value NOT NULL,
    INTEGER document_id,
    CHAR(36) aip_uuid,
    CHAR(36) archival_process_uuid,
    FOREIGN KEY (document_id) REFERENCES document(id),
    FOREIGN KEY (aip_uuid) REFERENCES aip(uuid),
    FOREIGN KEY (archival_process_uuid) REFERENCES archival_process(uuid),
    ENUM meta_type ('string', 'number', 'date') NOT NULL
);

CREATE TABLE document(
    INTEGER id PRIMARY KEY,
    VARCHAR(255) root_path NOT NULL,
    CHAR(36) aip_uuid NOT NULL,
    INTEGER aggregation_id FOREIGN KEY REFERENCES document_aggregation(id),
    FOREIGN KEY (aip_uuid) REFERENCES aip(uuid)
);

CREATE TABLE file(
    INTEGER id PRIMARY KEY,
    VARCHAR(255) relative_path NOT NULL,
    BOOLEAN is_main NOT NULL DEFAULT FALSE,
    INTEGER document_id,
    FOREIGN KEY (document_id) REFERENCES document(id)
);

CREATE TABLE aip(
    CHAR(36) uuid PRIMARY KEY,
    document_class_id INTEGER,
    CHAR(36) archival_process_uuid,
    FOREIGN KEY (archival_process_uuid) REFERENCES archival_process(uuid),
    FOREIGN KEY (document_class_id) REFERENCES document_class(id)
);

CREATE TABLE document_class(
    INTEGER id PRIMARY KEY,
    VARCHAR(255) class_name NOT NULL
);

CREATE TABLE archival_process(
    CHAR(36) uuid PRIMARY KEY
);

CREATE TABLE subject(
    INTEGER id PRIMARY KEY
);

CREATE TABLE subject_pf(
    INTEGER subject_id PRIMARY KEY NOT NULL,
    CHAR(11) cf UNIQUE,
    VARCHAR(50) first_name NOT NULL,
    VARCHAR(50) last_name NOT NULL,
    VARCHAR(255) digital_addresses
);

CREATE TABLE subject_pg(
    INTEGER subject_id PRIMARY KEY NOT NULL,
    VARCHAR(11) p_iva UNIQUE,
    VARCHAR(255) company_name NOT NULL,
    VARCHAR(255) office_name,
    VARCHAR(255) digital_addresses
);

CREATE TABLE subject_pai(
    INTEGER subject_id PRIMARY KEY NOT NULL,
    VARCHAR(20) administration_ipa_name NOT NULL,
    VARCHAR(20) administration_aoo_name NOT NULL,
    VARCHAR(20) administration_uor_name NOT NULL,
    VARCHAR(255) digital_addresses
);

CREATE TABLE subject_pae(
    INTEGER subject_id PRIMARY KEY NOT NULL,
    VARCHAR(11) administration_name NOT NULL UNIQUE,
    VARCHAR(255) office_name,
    VARCHAR(255) digital_addresses
);

CREATE TABLE subject_as(
    INTEGER subject_id PRIMARY KEY NOT NULL,
    VARCHAR(50) first_name,
    VARCHAR(50) last_name,
    CHAR(11) cf UNIQUE,
    VARCHAR(255) organization_name NOT NULL,
    VARCHAR(255) office_name NOT NULL,
    VARCHAR(255) digital_addresses
);

CREATE TABLE subject_sq(
    INTEGER subject_id PRIMARY KEY NOT NULL,
    VARCHAR(255) system_name NOT NULL
);

CREATE TABLE document_subject_association(
    INTEGER document_id NOT NULL,
    INTEGER subject_id NOT NULL,
    PRIMARY KEY (document_id, subject_id),
    FOREIGN KEY (document_id) REFERENCES document(id),
    FOREIGN KEY (subject_id) REFERENCES subject(id)
);

CREATE TABLE document_aggregation(
    INTEGER id PRIMARY KEY NOT NULL,
    INTEGER procedure_id FOREIGN KEY REFERENCES administrative_procedure(id),
    VARCHAR(70) type NOT NULL
);

CREATE TABLE administrative_procedure(
    INTEGER id PRIMARY KEY NOT NULL,
    VARCHAR(255) catalog_uri NOT NULL,
    VARCHAR(255) title NOT NULL,
    VARCHAR(60) subject_of_interest,
);

CREATE TABLE phase(
    INTEGER id PRIMARY KEY NOT NULL,
    VARCHAR(255) type NOT NULL,
    DATE start_date NOT NULL,
    DATE end_date,
    INTEGER administrative_procedure_id,
    FOREIGN KEY (administrative_procedure_id) REFERENCES administrative_procedure(id)
);