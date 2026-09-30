def pytest_addoption(parser):
    parser.addoption("--metrics", action="store_true", default=False, help="print the SENTINEL SCENARIO REPORT (docs/10 §6) after tests/scenarios")
