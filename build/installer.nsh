# installer.nsh — Discowl Browser
# Règle : première installation → créer les raccourcis
#         mise à jour          → ne JAMAIS toucher aux raccourcis

!macro customInstall
  # Détecter si c'est une mise à jour ou une première installation.
  # On vérifie si l'exe existait avant l'installation (clé registre laissée
  # par la session précédente de l'installeur NSIS).
  ReadRegStr $R0 HKCU "Software\discowl-browser" "InstallPath"
  StrCmp $R0 "" first_install is_update

  first_install:
    # Première installation — créer les raccourcis seulement s'ils n'existent pas
    IfFileExists "$DESKTOP\Discowl Browser.lnk" skip_desktop create_desktop
    create_desktop:
      CreateShortCut "$DESKTOP\Discowl Browser.lnk" "$INSTDIR\Discowl Browser.exe"
    skip_desktop:

    IfFileExists "$SMPROGRAMS\Discowl Browser\Discowl Browser.lnk" skip_startmenu create_startmenu
    create_startmenu:
      CreateDirectory "$SMPROGRAMS\Discowl Browser"
      CreateShortCut "$SMPROGRAMS\Discowl Browser\Discowl Browser.lnk" "$INSTDIR\Discowl Browser.exe"
    skip_startmenu:

    # Mémoriser le chemin pour les prochaines mises à jour
    WriteRegStr HKCU "Software\discowl-browser" "InstallPath" "$INSTDIR"
    Goto done_install

  is_update:
    # Mise à jour — ne rien faire du tout avec les raccourcis
    # Mettre à jour le chemin au cas où il aurait changé
    WriteRegStr HKCU "Software\discowl-browser" "InstallPath" "$INSTDIR"

  done_install:
!macroend

!macro customUnInstall
  # Désinstallation manuelle — supprimer raccourcis et clé registre
  Delete "$DESKTOP\Discowl Browser.lnk"
  Delete "$SMPROGRAMS\Discowl Browser\Discowl Browser.lnk"
  RMDir  "$SMPROGRAMS\Discowl Browser"
  DeleteRegKey HKCU "Software\discowl-browser"
!macroend

!macro customRemoveFiles
  # VIDE — ne jamais supprimer les raccourcis lors d'une mise à jour
!macroend
