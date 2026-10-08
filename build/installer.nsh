; Maps NSIS installer UI language → game language marker for first launch.
; English (1033) → en, Russian (1049) → ru. Default: en.
!macro customInstall
  StrCpy $0 "en"
  ${If} $LANGUAGE = 1049
    StrCpy $0 "ru"
  ${EndIf}
  FileOpen $1 "$INSTDIR\resources\install-lang" w
  FileWrite $1 "$0"
  FileClose $1
!macroend
