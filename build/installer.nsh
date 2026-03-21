# installer.nsh — Discowl Browser
#
# Cas 1 : Première installation
#         → créer les raccourcis bureau + Start Menu avec l'icône correcte
#         → écrire la clé registre pour les prochaines fois
#
# Cas 2 : Mise à jour via electron-updater (/S silent)
#         → customRemoveFiles est vide : aucun raccourci supprimé
#         → customInstall détecte la clé registre → ne recrée RIEN
#         → résultat : icônes intactes, barre des tâches intacte
#
# Cas 3 : Désinstallation manuelle
#         → supprimer raccourcis + clé registre proprement

!macro customInstall
  ReadRegStr $R0 HKCU "Software\discowl-browser" "InstallPath"

  # Si la clé existe → c'est une mise à jour, ne rien faire aux raccourcis
  StrCmp $R0 "" do_first_install do_update

  do_first_install:
    # Bureau
    IfFileExists "$DESKTOP\Discowl Browser.lnk" +3 0
      CreateShortCut "$DESKTOP\Discowl Browser.lnk" \
        "$INSTDIR\Discowl Browser.exe" "" \
        "$INSTDIR\Discowl Browser.exe" 0 \
        SW_SHOWNORMAL
    
    # Start Menu
    IfFileExists "$SMPROGRAMS\Discowl Browser\Discowl Browser.lnk" +4 0
      CreateDirectory "$SMPROGRAMS\Discowl Browser"
      CreateShortCut "$SMPROGRAMS\Discowl Browser\Discowl Browser.lnk" \
        "$INSTDIR\Discowl Browser.exe" "" \
        "$INSTDIR\Discowl Browser.exe" 0 \
        SW_SHOWNORMAL

    WriteRegStr HKCU "Software\discowl-browser" "InstallPath" "$INSTDIR"
    Goto install_done

  do_update:
    # Mise à jour silencieuse — ne toucher à rien
    # Juste mettre à jour le chemin en registre
    WriteRegStr HKCU "Software\discowl-browser" "InstallPath" "$INSTDIR"

  install_done:
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Discowl Browser.lnk"
  Delete "$SMPROGRAMS\Discowl Browser\Discowl Browser.lnk"
  RMDir  "$SMPROGRAMS\Discowl Browser"
  DeleteRegKey HKCU "Software\discowl-browser"
!macroend

!macro customRemoveFiles
  # INTENTIONNELLEMENT VIDE
  # electron-updater appelle ceci avant d'écraser les fichiers.
  # En le laissant vide, aucun raccourci n'est jamais supprimé
  # lors d'une mise à jour silencieuse.
!macroend
