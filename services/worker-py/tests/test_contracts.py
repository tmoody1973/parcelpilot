from app.contracts import enum_values, is_valid


def test_decision_mode_default_is_valid_and_junk_is_not():
    assert is_valid("DecisionMode", "rules_only")
    assert not is_valid("DecisionMode", "foo")


def test_final_status_values_match_conventions():
    assert enum_values("FinalStatus") == [
        "proceed_to_concept_design",
        "revise_scenario",
        "verify_before_committing",
        "insufficient_evidence",
    ]
